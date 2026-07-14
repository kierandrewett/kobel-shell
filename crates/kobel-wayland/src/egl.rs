// egl.rs -- EGL display/context (one shared GL context for the whole shell) plus a
// per-layer-surface wayland-egl window surface, and the Skia GL binding.
//
// One EGLDisplay, one EGLConfig, one shared EGLContext. Each layer surface gets its
// own WlEglSurface + EGLSurface but renders through the single shared context and a
// single shared Skia DirectContext (standard multi-window EGL usage). The Skia GL
// interface/context are created lazily on the first make_current, because building
// them calls into GL and needs a current context. Per docs/FREYA-PLAN.md section 3.

use std::ffi::c_void;
use std::ptr;
use std::rc::Rc;

use anyhow::{Context as _, anyhow};
use freya_engine::prelude::{
    ColorType, DirectContext, Format, FramebufferInfo, Interface, Surface as SkiaSurface, SurfaceOrigin,
    backend_render_targets, direct_contexts, wrap_backend_render_target,
};
use khronos_egl as egl;
use wayland_client::Proxy;
use wayland_client::protocol::wl_surface::WlSurface;
use wayland_egl::WlEglSurface;

type EglInstance = egl::DynamicInstance<egl::EGL1_4>;

/// Shared EGL objects (instance, display, config, context). Reference counted so a
/// per-surface [`LayerEglSurface`] can tear its EGLSurface down on drop.
struct EglCore {
    instance: EglInstance,
    display: egl::Display,
    config: egl::Config,
    context: egl::Context,
}

/// The shell-wide EGL/Skia state. Owned by the host; lives as long as the process.
pub struct Egl {
    core: Rc<EglCore>,
    /// Shared Skia GL context, created lazily once a context is current.
    gr_context: Option<DirectContext>,
    fb_info: FramebufferInfo,
    num_samples: usize,
    stencil_size: usize,
}

impl Drop for Egl {
    fn drop(&mut self) {
        // Abandon (rather than free) the Skia GL context: at shutdown there may be no
        // current EGL context, so let Skia release its references without touching GL.
        if let Some(gr) = self.gr_context.as_mut() {
            gr.abandon();
        }
    }
}

/// A single layer surface's EGL window surface. Drops its EGLSurface before its
/// WlEglSurface (wayland-egl requires the WlEglSurface outlive the EGLSurface, and
/// itself be destroyed before the underlying wl_surface -- see field/drop order in
/// FreyaLayerSurface).
pub struct LayerEglSurface {
    core: Rc<EglCore>,
    surface: egl::Surface,
    wl_egl: WlEglSurface,
    width: i32,
    height: i32,
}

impl Egl {
    /// Initialize EGL against a Wayland `wl_display` pointer.
    ///
    /// # Safety
    ///
    /// `display_ptr` must be a valid, live `wl_display` pointer for the calling
    /// process's Wayland connection, and must remain valid for the lifetime of the
    /// returned `Egl` (EGL holds no reference of its own -- the caller's connection
    /// must outlive it).
    pub unsafe fn new(display_ptr: *mut c_void) -> anyhow::Result<Self> {
        // SAFETY: loads libEGL.so.1 from the system.
        let instance = unsafe { EglInstance::load_required() }.map_err(|e| anyhow!("failed to load libEGL: {e}"))?;

        // SAFETY: display_ptr is a valid, live wl_display per this fn's precondition.
        let display =
            unsafe { instance.get_display(display_ptr) }.ok_or_else(|| anyhow!("eglGetDisplay returned no display"))?;

        let (major, minor) = instance.initialize(display).context("eglInitialize failed")?;
        tracing::info!("[egl] initialized EGL {major}.{minor}");

        instance
            .bind_api(egl::OPENGL_ES_API)
            .context("eglBindAPI(OpenGL ES) failed")?;

        // Try a GLES 3 config/context first, falling back to GLES 2. Some drivers
        // gate ES3 contexts behind configs advertising OPENGL_ES3_BIT.
        let (config, context) =
            Self::choose_config_and_context(&instance, display, 3, egl::OPENGL_ES3_BIT).or_else(|e3| {
                tracing::warn!("[egl] GLES3 config/context unavailable ({e3:#}); falling back to GLES2");
                Self::choose_config_and_context(&instance, display, 2, egl::OPENGL_ES2_BIT)
            })?;

        let stencil_size = instance
            .get_config_attrib(display, config, egl::STENCIL_SIZE)
            .unwrap_or(0) as usize;
        let num_samples = instance.get_config_attrib(display, config, egl::SAMPLES).unwrap_or(0) as usize;
        if stencil_size == 0 {
            tracing::warn!("[egl] chosen config has no stencil buffer; Skia clipping may misrender");
        }
        tracing::info!("[egl] config: stencil={stencil_size} samples={num_samples}");

        // fbo 0 = the EGL window surface's default framebuffer.
        let fb_info = FramebufferInfo {
            fboid: 0,
            format: Format::RGBA8.into(),
            ..Default::default()
        };

        Ok(Self {
            core: Rc::new(EglCore {
                instance,
                display,
                config,
                context,
            }),
            gr_context: None,
            fb_info,
            num_samples,
            stencil_size,
        })
    }

    /// Choose an RGBA8 + stencil + window config for the given GLES renderable bit and
    /// create a matching context. Alpha lets translucent panels composite; the stencil
    /// buffer is required by Skia's path/clip rendering.
    fn choose_config_and_context(
        instance: &EglInstance,
        display: egl::Display,
        client_major: egl::Int,
        renderable_bit: egl::Int,
    ) -> anyhow::Result<(egl::Config, egl::Context)> {
        let config_attrs = [
            egl::RED_SIZE,
            8,
            egl::GREEN_SIZE,
            8,
            egl::BLUE_SIZE,
            8,
            egl::ALPHA_SIZE,
            8,
            egl::STENCIL_SIZE,
            8,
            egl::SURFACE_TYPE,
            egl::WINDOW_BIT,
            egl::RENDERABLE_TYPE,
            renderable_bit,
            egl::NONE,
        ];
        let config = instance
            .choose_first_config(display, &config_attrs)
            .context("eglChooseConfig failed")?
            .ok_or_else(|| anyhow!("no EGL config with RGBA8 + stencil + window support"))?;

        let context_attrs = [
            egl::CONTEXT_MAJOR_VERSION,
            client_major,
            egl::CONTEXT_MINOR_VERSION,
            0,
            egl::NONE,
        ];
        let context = instance
            .create_context(display, config, None, &context_attrs)
            .context("eglCreateContext failed")?;
        tracing::info!("[egl] created GLES {client_major}.x context");
        Ok((config, context))
    }

    /// Create an EGL window surface backing `wl_surface` at the given physical size.
    pub fn create_surface(&self, wl_surface: &WlSurface, width: i32, height: i32) -> anyhow::Result<LayerEglSurface> {
        let width = width.max(1);
        let height = height.max(1);
        let wl_egl =
            WlEglSurface::new(wl_surface.id(), width, height).map_err(|e| anyhow!("WlEglSurface::new failed: {e}"))?;
        // SAFETY: wl_egl.ptr() is a valid EGLNativeWindow for this display/platform.
        let surface = unsafe {
            self.core.instance.create_window_surface(
                self.core.display,
                self.core.config,
                wl_egl.ptr() as egl::NativeWindowType,
                None,
            )
        }
        .context("eglCreateWindowSurface failed")?;
        Ok(LayerEglSurface {
            core: self.core.clone(),
            surface,
            wl_egl,
            width,
            height,
        })
    }

    /// Bind `surface` for rendering and ensure the shared Skia context exists.
    pub fn make_current(&mut self, surface: &LayerEglSurface) -> anyhow::Result<()> {
        self.core
            .instance
            .make_current(
                self.core.display,
                Some(surface.surface),
                Some(surface.surface),
                Some(self.core.context),
            )
            .context("eglMakeCurrent failed")?;
        if self.gr_context.is_none() {
            self.gr_context = Some(self.create_gr_context()?);
            tracing::info!("[egl] created shared Skia GL context");
        }
        Ok(())
    }

    fn create_gr_context(&self) -> anyhow::Result<DirectContext> {
        let instance = &self.core.instance;
        let interface = Interface::new_load_with(|name| {
            if name == "eglGetCurrentDisplay" {
                return ptr::null();
            }
            match instance.get_proc_address(name) {
                Some(f) => f as *const c_void,
                None => ptr::null(),
            }
        })
        .ok_or_else(|| anyhow!("failed to build Skia GL interface via eglGetProcAddress"))?;
        direct_contexts::make_gl(interface, None).ok_or_else(|| anyhow!("failed to create Skia GL DirectContext"))
    }

    /// Wrap the current window surface's default framebuffer as a fresh Skia surface
    /// (created per frame, per the plan).
    pub fn wrap_frame(&mut self, width: i32, height: i32) -> anyhow::Result<SkiaSurface> {
        let num_samples = self.num_samples;
        let stencil_size = self.stencil_size;
        let fb_info = self.fb_info;
        let gr = self
            .gr_context
            .as_mut()
            .ok_or_else(|| anyhow!("wrap_frame before make_current"))?;
        let render_target =
            backend_render_targets::make_gl((width.max(1), height.max(1)), num_samples, stencil_size, fb_info);
        wrap_backend_render_target(
            gr,
            &render_target,
            SurfaceOrigin::BottomLeft,
            ColorType::RGBA8888,
            None,
            None,
        )
        .ok_or_else(|| anyhow!("wrap_backend_render_target returned None"))
    }

    /// Flush queued Skia GL commands before the buffer swap.
    pub fn flush(&mut self) {
        if let Some(gr) = self.gr_context.as_mut() {
            gr.flush_submit_and_sync_cpu();
        }
    }

    /// Post the current back buffer to the compositor.
    pub fn swap(&self, surface: &LayerEglSurface) -> anyhow::Result<()> {
        self.core
            .instance
            .swap_buffers(self.core.display, surface.surface)
            .context("eglSwapBuffers failed")
    }
}

impl LayerEglSurface {
    /// Resize the EGL back buffer to a new physical size. Cheap no-op when unchanged.
    pub fn resize(&mut self, width: i32, height: i32) {
        let width = width.max(1);
        let height = height.max(1);
        if width == self.width && height == self.height {
            return;
        }
        self.wl_egl.resize(width, height, 0, 0);
        self.width = width;
        self.height = height;
    }
}

impl Drop for LayerEglSurface {
    fn drop(&mut self) {
        // Destroy the EGLSurface first; the WlEglSurface field drops afterwards, and
        // the owning wl_surface (in the LayerSurface) is dropped later still.
        let _ = self.core.instance.destroy_surface(self.core.display, self.surface);
    }
}

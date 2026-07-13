//! Launcher fuzzy match + frecency (straight port of `ags/lib/fuzzy.ts`).
//!
//! [`fuzzy`] is a subsequence match, case-insensitive, that rewards matches
//! starting at a word boundary and runs of consecutive characters, with a
//! small penalty for longer targets so tight/short matches win ties. Marks
//! are target CHAR indices (never byte offsets) so callers can safely
//! highlight matched characters on Unicode text.
//!
//! [`Frecency`] persists per-id use counts to the same `freq.json` format AGS
//! used, so launcher history survives the port. It is a plain UI-thread
//! struct (Freya state is not thread-safe) meant to be loaded once at
//! startup and held for the process lifetime.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Characters that count as a word boundary immediately before a match
/// (`ags/lib/fuzzy.ts`: `" -_./".includes(t[i - 1])`).
const BOUNDARY_CHARS: &str = " -_./";

/// Word-boundary bonus: the matched char is first, or follows a
/// [`BOUNDARY_CHARS`] separator.
const BOUNDARY_BONUS: f32 = 4.0;
/// Bonus when the matched char immediately follows the previous match.
const CONSECUTIVE_BONUS: f32 = 2.0;
/// Base bonus for a match that is neither a boundary nor consecutive.
const BASE_BONUS: f32 = 1.0;
/// Per-target-char length penalty, so shorter targets win ties.
const LENGTH_PENALTY: f32 = 0.02;

/// Result of a successful [`fuzzy`] match.
#[derive(Debug, Clone, PartialEq)]
pub struct FuzzyMatch {
    pub score: f32,
    /// Target CHAR indices (not byte offsets) consumed by the match, in
    /// ascending order.
    pub marks: Vec<usize>,
}

/// Lowercase `s` char-by-char, keeping a 1:1 mapping to `s.chars()` so the
/// result can be zipped with char indices. Multi-char lowercasings (e.g.
/// German sharp s) collapse to their first char -- an acceptable
/// approximation for launcher matching, and it never indexes by byte.
fn lower_chars(s: &str) -> Vec<char> {
    s.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect()
}

/// Subsequence-match `query` against `target`, case-insensitive. `None`
/// unless every query char is matched, in order, somewhere in `target`.
pub fn fuzzy(query: &str, target: &str) -> Option<FuzzyMatch> {
    let query_lower = lower_chars(query);
    let target_lower = lower_chars(target);
    let target_chars: Vec<char> = target.chars().collect();
    debug_assert_eq!(target_lower.len(), target_chars.len());

    let mut qi = 0usize;
    let mut score = 0.0f32;
    let mut last: isize = -2;
    let mut marks = Vec::new();

    for (i, &tc) in target_lower.iter().enumerate() {
        if qi >= query_lower.len() {
            break;
        }
        if tc != query_lower[qi] {
            continue;
        }
        marks.push(i);
        let at_boundary = i == 0 || BOUNDARY_CHARS.contains(target_chars[i - 1]);
        score += if at_boundary {
            BOUNDARY_BONUS
        } else if last == i as isize - 1 {
            CONSECUTIVE_BONUS
        } else {
            BASE_BONUS
        };
        last = i as isize;
        qi += 1;
    }

    if qi == query_lower.len() {
        Some(FuzzyMatch { score: score - target_chars.len() as f32 * LENGTH_PENALTY, marks })
    } else {
        None
    }
}

/// Frecency cap: an exact prefix match must always outrank pure habit
/// (`ags/lib/fuzzy.ts` critique A2).
const BOOST_CAP: f32 = 3.0;

/// Persistent per-id use counts backing the launcher's frecency boost. Same
/// on-disk JSON shape as AGS (`{ "id": count, ... }`) at the same path, so
/// history carries over. Not thread-safe by design: UI-thread only, load
/// once, hold for the process.
pub struct Frecency {
    path: PathBuf,
    counts: HashMap<String, u32>,
}

impl Frecency {
    /// Load counts from the default store
    /// (`$XDG_STATE_HOME/kobel/freq.json`, falling back to
    /// `~/.local/state/kobel/freq.json`). Missing or unreadable/corrupt
    /// files start empty, matching the AGS `try {} catch {}` behaviour.
    pub fn load() -> Self {
        Self::load_from(default_store_path())
    }

    /// Load counts from an explicit store path (tests parameterize this to a
    /// tempdir so runs never touch the real state file).
    pub fn load_from(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let counts = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, counts }
    }

    /// Capped `log2(1 + count)` boost for `id`. Unseen ids score 0.
    pub fn boost(&self, id: &str) -> f32 {
        let count = self.frequency(id);
        ((count as f32 + 1.0).log2()).min(BOOST_CAP)
    }

    /// Raw use count for `id` (0 if it was never bumped).
    pub fn frequency(&self, id: &str) -> u32 {
        self.counts.get(id).copied().unwrap_or(0)
    }

    /// Increment `id`'s use count and persist immediately: create the store's
    /// parent directory if needed, write to a sibling temp file, then rename
    /// over the real path so a crash mid-write never truncates it.
    pub fn bump(&mut self, id: &str) {
        *self.counts.entry(id.to_string()).or_insert(0) += 1;
        if let Err(e) = self.write() {
            tracing::warn!("[fuzzy] frecency write to {} failed: {e}", self.path.display());
        }
    }

    fn write(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec(&self.counts).unwrap_or_default();
        let mut tmp_name = self.path.file_name().unwrap_or_default().to_os_string();
        tmp_name.push(".tmp");
        let tmp_path = self.path.with_file_name(tmp_name);
        fs::write(&tmp_path, &json)?;
        fs::rename(&tmp_path, &self.path)
    }
}

/// `$XDG_STATE_HOME/kobel/freq.json`, falling back to
/// `~/.local/state/kobel/freq.json` when `XDG_STATE_HOME` is unset (matches
/// `GLib.get_user_state_dir()`, which applies the same fallback).
fn default_store_path() -> PathBuf {
    let state_dir = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(|| PathBuf::from(".local/state"));
    state_dir.join("kobel").join("freq.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn matches_ordered_subsequence() {
        let m = fuzzy("fx", "firefox").expect("f..x is a subsequence of firefox");
        assert_eq!(m.marks, vec![0, 6]);
    }

    #[test]
    fn rejects_missing_or_out_of_order_chars() {
        assert!(fuzzy("zzz", "firefox").is_none(), "no z in firefox");
        assert!(fuzzy("xf", "firefox").is_none(), "x before f: not a subsequence");
    }

    #[test]
    fn word_boundary_beats_mid_word() {
        // Same query, same target length; only the char preceding the match
        // differs (separator vs. plain letter).
        let boundary = fuzzy("file", "-file").unwrap();
        let mid_word = fuzzy("file", "xfile").unwrap();
        assert!(
            boundary.score > mid_word.score,
            "boundary {} should beat mid-word {}",
            boundary.score,
            mid_word.score
        );
    }

    #[test]
    fn consecutive_beats_scattered() {
        // Both targets are the same length and start the match mid-word (no
        // boundary bonus in play), isolating the consecutive-run bonus.
        let consecutive = fuzzy("ab", "xabx").unwrap();
        let scattered = fuzzy("ab", "xaxb").unwrap();
        assert!(
            consecutive.score > scattered.score,
            "consecutive {} should beat scattered {}",
            consecutive.score,
            scattered.score
        );
    }

    #[test]
    fn length_penalty_breaks_ties() {
        // Identical raw bonus shape (boundary start + one consecutive char);
        // only the trailing padding differs, so the length penalty alone
        // must separate them.
        let short = fuzzy("ab", "ab").unwrap();
        let long = fuzzy("ab", "abxxxx").unwrap();
        assert!(short.score > long.score, "shorter target should win the tie");
    }

    #[test]
    fn unicode_target_is_char_indexed_not_byte_indexed() {
        // Multi-byte lead char (COFFEE, 3 bytes in UTF-8) before the match;
        // a byte-indexed implementation would panic or misalign marks.
        let m = fuzzy("fire", "\u{2615}firefox").expect("fire is a subsequence");
        assert_eq!(m.marks, vec![1, 2, 3, 4], "marks must be char indices, not byte offsets");
    }

    #[test]
    fn boost_is_zero_for_unseen_and_capped_at_three() {
        let dir = temp_dir("boost-cap");
        let mut store = Frecency::load_from(dir.join("freq.json"));
        assert_eq!(store.boost("nvim"), 0.0);

        for _ in 0..7 {
            store.bump("nvim");
        }
        // log2(1 + 7) == 3.0 exactly: right at the cap.
        assert!((store.boost("nvim") - 3.0).abs() < 1e-6);

        for _ in 0..20 {
            store.bump("nvim");
        }
        assert_eq!(store.boost("nvim"), 3.0, "boost must never exceed the cap");

        cleanup(&dir);
    }

    #[test]
    fn bump_round_trips_through_the_store_file() {
        let dir = temp_dir("round-trip");
        let store_path = dir.join("kobel").join("freq.json"); // nested: exercises create_dir_all

        let mut store = Frecency::load_from(&store_path);
        assert_eq!(store.frequency("firefox"), 0);
        store.bump("firefox");
        store.bump("firefox");
        store.bump("kitty");
        assert_eq!(store.frequency("firefox"), 2);
        assert_eq!(store.frequency("kitty"), 1);

        // Same format as AGS: a flat JSON object of id -> count.
        let raw = fs::read_to_string(&store_path).expect("store file must exist after bump");
        let parsed: HashMap<String, u32> =
            serde_json::from_str(&raw).expect("store must be a plain id->count JSON map");
        assert_eq!(parsed.get("firefox"), Some(&2));
        assert_eq!(parsed.get("kitty"), Some(&1));

        // Reloading from the same path must see the persisted counts.
        let reloaded = Frecency::load_from(&store_path);
        assert_eq!(reloaded.frequency("firefox"), 2);
        assert_eq!(reloaded.frequency("kitty"), 1);

        cleanup(&dir);
    }

    /// A fresh, not-yet-created temp directory for one test, so store paths
    /// never collide across parallel test threads/processes.
    fn temp_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("kobel-fuzzy-test-{}-{tag}-{n}", std::process::id()))
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }
}

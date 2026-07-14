use freya_testing::prelude::*;

#[test]
fn empty_root_mounts_in_the_headless_runner() {
    let mut runner = launch_test(kobel_ui::app);
    runner.sync_and_update();
}

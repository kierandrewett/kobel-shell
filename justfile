set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all --check

check:
    cargo check --workspace --all-targets
    cargo check -p kobel-bar --bin kobel-bar-preview --features devtools
    cargo check -p kobel-dock --bin kobel-dock-preview --features devtools

test:
    cargo test --workspace --all-targets
    cargo test -p kobel-bar --bin kobel-bar-preview --features devtools
    cargo test -p kobel-dock --bin kobel-dock-preview --features devtools

bar:
    cargo run -p kobel-bar

bar-preview:
    FREYA_DEVTOOLS_ADDR="${FREYA_DEVTOOLS_ADDR:-127.0.0.1:7354}" cargo run -p kobel-bar --bin kobel-bar-preview --features devtools

bar-inspector:
    FREYA_DEVTOOLS_ADDR="${FREYA_DEVTOOLS_ADDR:-127.0.0.1:7354}" cargo run -p freya-devtools-app

bar-test:
    cargo test -p kobel-bar --all-targets --features devtools

dock:
    cargo run -p kobel-dock

dock-preview:
    FREYA_DEVTOOLS_ADDR="${FREYA_DEVTOOLS_ADDR:-127.0.0.1:7355}" cargo run -p kobel-dock --bin kobel-dock-preview --features devtools

dock-inspector:
    FREYA_DEVTOOLS_ADDR="${FREYA_DEVTOOLS_ADDR:-127.0.0.1:7355}" cargo run -p freya-devtools-app

dock-test:
    cargo test -p kobel-dock --all-targets --features devtools

host-bar-dock:
    ./scripts/run-bar-dock-in-gnoblin.sh

host-spike:
    ./scripts/run-spike-in-gnoblin.sh

host-input:
    INPUT_TEST=1 ./scripts/run-spike-in-gnoblin.sh

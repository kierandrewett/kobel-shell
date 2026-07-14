set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all --check

check:
    cargo check --workspace --all-targets
    cargo check -p kobel-ui --bin preview --features devtools

test:
    cargo test --workspace --all-targets

ui-check:
    cargo check -p kobel-ui --all-targets

ui-check-devtools:
    cargo check -p kobel-ui --bin preview --features devtools


ui-test:
    cargo test -p kobel-ui

ui-preview:
    cargo run -p kobel-ui --bin preview --features devtools

install-freya-devtools:
    cargo install --git https://github.com/marc2332/freya --rev 5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6 --locked freya-devtools-app

freya-devtools:
    freya-devtools-app

host-spike:
    ./scripts/run-spike-in-gnoblin.sh

host-input:
    INPUT_TEST=1 ./scripts/run-spike-in-gnoblin.sh

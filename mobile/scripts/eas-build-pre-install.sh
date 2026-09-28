#!/bin/sh
set -eu

# EAS runs post-install after CocoaPods on iOS. Generate Rust/Swift artifacts here,
# before podspec evaluation, because binaries and bindings are deliberately ignored.
if [ "${EAS_BUILD_PLATFORM:-}" != ios ]; then exit 0; fi
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --no-modify-path --default-toolchain none
fi
rustup toolchain install 1.94.1 --profile minimal
rustup target add --toolchain 1.94.1 aarch64-apple-ios aarch64-apple-ios-sim
bash "$ROOT/modules/gizu-stored-signer/scripts/build.sh" ios

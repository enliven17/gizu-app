#!/bin/sh
set -eu

# Generate native libraries and bindings inside EAS's build workspace because
# those artifacts are ignored by Git. iOS needs them before CocoaPods runs.
case "${EAS_BUILD_PLATFORM:-}" in
  android|ios) PLATFORM="$EAS_BUILD_PLATFORM" ;;
  *) exit 0 ;;
esac
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --no-modify-path --default-toolchain none
fi
rustup toolchain install 1.94.1 --profile minimal
case "$PLATFORM" in
  android) rustup target add --toolchain 1.94.1 aarch64-linux-android ;;
  ios) rustup target add --toolchain 1.94.1 aarch64-apple-ios aarch64-apple-ios-sim ;;
esac
bash "$ROOT/modules/gizu-stored-signer/scripts/build.sh" "$PLATFORM"

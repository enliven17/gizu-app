#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
cd "$ROOT/core"
MODE=${1:-android}
case "$MODE" in android|ios|all) ;; *) echo "Usage: build.sh [android|ios|all]" >&2; exit 2 ;; esac
if [ "$MODE" != android ] && [ "$(uname -s)" != Darwin ]; then echo "iOS requires macOS" >&2; exit 2; fi
case "$(uname -s)" in
 Darwin) HOST_LIBRARY=target/debug/libgizu_stored_signer_core.dylib; NDK_HOST=darwin-x86_64; DEFAULT_SDK="$HOME/Library/Android/sdk" ;;
 Linux) HOST_LIBRARY=target/debug/libgizu_stored_signer_core.so; NDK_HOST=linux-x86_64; DEFAULT_SDK="$HOME/Android/Sdk" ;;
 *) echo "Build on macOS or Linux" >&2; exit 2 ;;
esac
cargo build --locked --features cli
mkdir -p "$ROOT/generated"
target/debug/uniffi-bindgen generate --library "$HOST_LIBRARY" --language kotlin --language swift --out-dir "$ROOT/generated" --no-format
if [ "$MODE" = android ] || [ "$MODE" = all ]; then
  SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-"$DEFAULT_SDK"}}
  NDK=${ANDROID_NDK_HOME:-"$SDK/ndk/27.1.12297006"}
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK/toolchains/llvm/prebuilt/$NDK_HOST/bin/aarch64-linux-android24-clang"
  cargo build --locked --release --lib --target aarch64-linux-android
  mkdir -p "$ROOT/android/src/main/jniLibs/arm64-v8a"
  cp target/aarch64-linux-android/release/libgizu_stored_signer_core.so "$ROOT/android/src/main/jniLibs/arm64-v8a/"
fi
if [ "$MODE" = all ] || [ "$MODE" = ios ]; then
  cargo build --locked --release --lib --target aarch64-apple-ios
  cargo build --locked --release --lib --target aarch64-apple-ios-sim
  mkdir -p "$ROOT/generated/headers" "$ROOT/ios/Generated"
  cp "$ROOT/generated/gizu_stored_signer_coreFFI.h" "$ROOT/generated/headers/"
  cp "$ROOT/generated/gizu_stored_signer_coreFFI.modulemap" "$ROOT/generated/headers/module.modulemap"
  cp "$ROOT/generated/gizu_stored_signer_core.swift" "$ROOT/ios/Generated/"
  # xcodebuild requires a fresh generated output; never touches source/signing keys.
  if [ -d "$ROOT/ios/GizuStoredSignerCore.xcframework" ]; then
    rm -rf "$ROOT/ios/GizuStoredSignerCore.xcframework"
  fi
  xcodebuild -create-xcframework \
    -library target/aarch64-apple-ios/release/libgizu_stored_signer_core.a -headers "$ROOT/generated/headers" \
    -library target/aarch64-apple-ios-sim/release/libgizu_stored_signer_core.a -headers "$ROOT/generated/headers" \
    -output "$ROOT/ios/GizuStoredSignerCore.xcframework"
fi

#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
cd "$ROOT/core"
case "$(uname -s)" in
 Darwin) HOST_LIBRARY=target/debug/libgizu_stored_signer_core.dylib; NDK_HOST=darwin-x86_64; DEFAULT_SDK="$HOME/Library/Android/sdk" ;;
 Linux) HOST_LIBRARY=target/debug/libgizu_stored_signer_core.so; NDK_HOST=linux-x86_64; DEFAULT_SDK="$HOME/Android/Sdk" ;;
 *) echo "Build on macOS or Linux" >&2; exit 2 ;;
esac
cargo build --locked --features cli
mkdir -p "$ROOT/generated"
target/debug/uniffi-bindgen generate --library "$HOST_LIBRARY" --language kotlin --out-dir "$ROOT/generated" --no-format
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-"$DEFAULT_SDK"}}
NDK=${ANDROID_NDK_HOME:-"$SDK/ndk/27.1.12297006"}
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK/toolchains/llvm/prebuilt/$NDK_HOST/bin/aarch64-linux-android24-clang"
cargo build --locked --release --lib --target aarch64-linux-android
mkdir -p "$ROOT/android/src/main/jniLibs/arm64-v8a"
cp target/aarch64-linux-android/release/libgizu_stored_signer_core.so "$ROOT/android/src/main/jniLibs/arm64-v8a/"

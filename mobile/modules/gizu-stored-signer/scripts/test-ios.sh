#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ "$(uname -s)" != Darwin ]; then echo "iOS tests require macOS and Xcode" >&2; exit 2; fi
DEVICE=${GIZU_IOS_TEST_DEVICE:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; print(next(d["udid"] for runtime,devices in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in devices if d["name"].startswith("iPhone")))')}
xcodebuild -scheme GizuStoredSignerNative -destination "platform=iOS Simulator,id=$DEVICE" CODE_SIGNING_ALLOWED=NO test

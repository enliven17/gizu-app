#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ "$(uname -s)" != Darwin ]; then echo "iOS tests require macOS and Xcode" >&2; exit 2; fi
DEVICE=${GIZU_IOS_TEST_DEVICE:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; print(next(d["udid"] for runtime,devices in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in devices if d["name"].startswith("iPhone")))')}
CONFIGURATION=${GIZU_IOS_TEST_CONFIGURATION:-Debug}
case "$CONFIGURATION" in Debug|Release) ;; *) echo "Expected Debug or Release test configuration" >&2; exit 2 ;; esac
# @testable visibility is for this native test target only, never an app archive.
xcodebuild -scheme GizuStoredSignerNative -configuration "$CONFIGURATION" ENABLE_TESTABILITY=YES -destination "platform=iOS Simulator,id=$DEVICE" CODE_SIGNING_ALLOWED=NO test

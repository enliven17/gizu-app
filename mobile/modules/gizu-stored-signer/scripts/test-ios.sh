#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
if [ "$(uname -s)" != Darwin ]; then echo "iOS tests require macOS and Xcode" >&2; exit 2; fi
DEVICE=${GIZU_IOS_TEST_DEVICE:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; devices = [d["udid"] for runtime,devices in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in devices if d["name"].startswith("iPhone")]; sys.exit("No available iPhone simulator. Install an iOS runtime in Xcode Settings > Components.") if not devices else print(devices[0])')}
CONFIGURATION=${GIZU_IOS_TEST_CONFIGURATION:-Debug}
case "$CONFIGURATION" in Debug|Release) ;; *) echo "Expected Debug or Release test configuration" >&2; exit 2 ;; esac
# Optional CI result bundle; Xcode refuses existing paths, so never overwrite a prior report.
set --
if [ -n "${GIZU_IOS_TEST_RESULTS:-}" ]; then
  if [ -e "$GIZU_IOS_TEST_RESULTS" ]; then echo "Result bundle already exists: $GIZU_IOS_TEST_RESULTS" >&2; exit 2; fi
  set -- -resultBundlePath "$GIZU_IOS_TEST_RESULTS"
fi
# @testable visibility is for this native test target only, never an app archive.
xcodebuild -scheme GizuStoredSignerNative -configuration "$CONFIGURATION" ENABLE_TESTABILITY=YES -destination "platform=iOS Simulator,id=$DEVICE" CODE_SIGNING_ALLOWED=NO "$@" test

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = require.resolve("../eas-build-pre-install.sh");

test("Android EAS pre-install installs the Rust target and builds signer artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gizu-eas-hook-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const cargoBin = path.join(root, ".cargo", "bin");
  const bin = path.join(root, "bin");
  const calls = path.join(root, "calls.txt");
  fs.mkdirSync(cargoBin, { recursive: true });
  fs.mkdirSync(bin);

  for (const [directory, name] of [
    [cargoBin, "rustup"],
    [bin, "bash"],
  ]) {
    fs.writeFileSync(
      path.join(directory, name),
      `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "$EAS_HOOK_TEST_CALLS"\n`,
      { mode: 0o755 },
    );
  }

  const result = spawnSync("/bin/sh", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      EAS_BUILD_PLATFORM: "android",
      EAS_HOOK_TEST_CALLS: calls,
      HOME: root,
      PATH: `${bin}:/usr/bin:/bin`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const recorded = fs.readFileSync(calls, "utf8");
  assert.match(recorded, /rustup target add --toolchain 1\.94\.1 aarch64-linux-android/);
  assert.match(recorded, /build\.sh android/);
});

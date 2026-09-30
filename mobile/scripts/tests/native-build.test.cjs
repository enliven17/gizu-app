const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = require.resolve("../../modules/gizu-stored-signer/scripts/build.sh");
const nativeTest = process.platform === "win32" ? test.skip : test;

function environment(t, { host = "Linux", targets = "aarch64-linux-android", sdk = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gizu-build-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  function executable(file, body) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  executable(path.join(bin, "uname"), `echo '${host}'`);
  executable(path.join(bin, "rustup"), `printf '%s\\n' '${targets}'`);
  executable(path.join(bin, "cargo"), 'echo "Unexpected compilation" >&2; exit 99');
  executable(path.join(bin, "xcodebuild"), "exit 0");
  executable(path.join(bin, "xcrun"), `exit ${sdk ? 0 : 1}`);
  const ndk = path.join(root, "ndk with spaces");
  const compiler = path.join(
    ndk,
    "toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang",
  );
  executable(compiler, "exit 0");
  return {
    compiler,
    root,
    bin,
    runIos: (extraEnv) =>
      spawnSync("/bin/sh", [path.join(path.dirname(script), "test-ios.sh")], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: root,
          PATH: `${bin}:/usr/bin:/bin`,
          GIZU_IOS_TEST_DEVICE: "fake-iphone",
          ...extraEnv,
        },
      }),
    run: (...args) =>
      spawnSync("/bin/sh", [script, ...args], {
        encoding: "utf8",
        env: { ...process.env, HOME: root, PATH: `${bin}:/usr/bin:/bin`, ANDROID_NDK_HOME: ndk },
      }),
  };
}

nativeTest("Android preflight accepts an explicit NDK path with spaces without compiling", (t) => {
  const result = environment(t).run("android", "--check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prerequisites are ready/);
});

nativeTest("missing NDK fails before compilation with an installation command", (t) => {
  const env = environment(t);
  fs.rmSync(env.compiler);
  const result = env.run("android");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /sdkmanager 'ndk;27.1.12297006'/);
  assert.doesNotMatch(result.stderr, /Unexpected compilation/);
});

nativeTest("missing Rust target explains how to install the pinned target", (t) => {
  const result = environment(t, { targets: "" }).run("android");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /rustup target add --toolchain 1.94.1 aarch64-linux-android/);
});

nativeTest("iOS SDK failure is reported before compilation", (t) => {
  const result = environment(t, { host: "Darwin", sdk: false }).run("ios");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Select full Xcode/);
});

nativeTest("iOS preflight requires device and simulator targets", (t) => {
  const env = environment(t, {
    host: "Darwin",
    targets: "aarch64-apple-ios\naarch64-apple-ios-sim",
  });
  const result = env.run("ios", "--check");
  assert.equal(result.status, 0, result.stderr);
});

nativeTest("invalid modes and extra arguments are rejected", (t) => {
  const env = environment(t);
  for (const args of [["invalid"], ["android", "--unknown"], ["android", "--check", "extra"]]) {
    assert.equal(env.run(...args).status, 2);
  }
});

nativeTest("iOS tests preserve an existing result bundle", (t) => {
  const env = environment(t, { host: "Darwin" });
  const results = path.join(env.root, "previous.xcresult");
  fs.mkdirSync(results);
  fs.writeFileSync(path.join(results, "keep"), "previous run");
  const result = env.runIos({ GIZU_IOS_TEST_RESULTS: results });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Result bundle already exists/);
  assert.equal(fs.readFileSync(path.join(results, "keep"), "utf8"), "previous run");
});

nativeTest("iOS tests pass a result path with spaces and Release configuration to Xcode", (t) => {
  const env = environment(t, { host: "Darwin" });
  fs.writeFileSync(path.join(env.bin, "xcodebuild"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
    mode: 0o755,
  });
  const results = path.join(env.root, "new report.xcresult");
  const result = env.runIos({
    GIZU_IOS_TEST_RESULTS: results,
    GIZU_IOS_TEST_CONFIGURATION: "Release",
  });
  assert.equal(result.status, 0, result.stderr);
  const args = result.stdout.trim().split("\n");
  assert.equal(args[args.indexOf("-resultBundlePath") + 1], results);
  assert.equal(args[args.indexOf("-configuration") + 1], "Release");
});

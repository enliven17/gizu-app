import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anvilRelease,
  verifyAnvilFile,
  installAnvil,
} from "../../scripts/install-anvil.mjs";
test("runtime selects only the pinned supported Linux artifact", () => {
  const release = anvilRelease("linux", "x64");
  assert.equal(release.version, "1.8.3");
  assert.equal(
    release.archiveSha256,
    "7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568",
  );
  assert.equal(
    release.url,
    "https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz",
  );
  assert.throws(() => anvilRelease("darwin", "arm64"), /Linux x64/);
  assert.throws(() => anvilRelease("linux", "arm64"), /Linux x64/);
});
test("corrupt archive cannot extract or execute and symlink cache cannot qualify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gizu-anvil-test-"));
  try {
    const bad = join(dir, "bad.tar.gz"),
      link = join(dir, "linked");
    await writeFile(bad, "not a trusted executable");
    await symlink(bad, link);
    await assert.rejects(
      verifyAnvilFile(bad, anvilRelease("linux", "x64").archiveSha256),
      /checksum/,
    );
    await assert.rejects(
      verifyAnvilFile(link, anvilRelease("linux", "x64").archiveSha256),
      /regular file/,
    );
    await assert.rejects(
      installAnvil({
        platform: "linux",
        arch: "x64",
        archiveFile: bad,
        destinationDir: join(dir, "install"),
      }),
      /checksum/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

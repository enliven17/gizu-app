import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const scripts = dirname(fileURLToPath(import.meta.url));
const release = Object.freeze({
  version: "1.8.3",
  commit: "cae51ad458f6abb64852b7709eb784352429825d",
  filename: "foundry_v1.8.3_linux_amd64.tar.gz",
  // Published release API digest AND downloaded official .sha256 file agree.
  archiveSha256:
    "7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568",
  // Derived only after verifying that archive; also verifies an existing build cache.
  binarySha256:
    "674a06c97a01350cd00241762bbfb01ebcafce9b6e8cbd6c8758ecea6ef4b968",
  url: "https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz",
});
export function anvilRelease(platform = process.platform, arch = process.arch) {
  if (platform !== "linux" || arch !== "x64")
    throw new Error(
      "Pinned Render Anvil installation requires Linux x64; use an explicitly verified local Anvil for other platforms.",
    );
  return release;
}
export async function verifyAnvilFile(
  path,
  expected,
  maximumBytes = 128 * 1024 * 1024,
) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes)
    throw new Error("Anvil artifact must be a bounded regular file.");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  if (hash.digest("hex") !== expected)
    throw new Error("Pinned Anvil checksum mismatch.");
}
function executable(path) {
  const output = execFileSync(path, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4096,
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (
    !output.startsWith(`anvil Version: ${release.version}\n`) ||
    !output.includes(`Commit SHA: ${release.commit}\n`)
  )
    throw new Error("Pinned Anvil executable version mismatch.");
}
async function download(path) {
  const response = await fetch(release.url, {
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok || !response.body || !response.url.startsWith("https://"))
    throw new Error("Official Anvil artifact download unavailable.");
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(bytes, _encoding, callback) {
        size += bytes.length;
        callback(
          size > 128 * 1024 * 1024
            ? new Error("Anvil archive exceeds the download limit.")
            : null,
          bytes,
        );
      },
    }),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
}
/** Build-time only. A supplied offline archive must satisfy exactly the same pinned digest. */
export async function installAnvil({
  archiveFile,
  destinationDir = resolve(scripts, "../.runtime/anvil-v1.8.3"),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  anvilRelease(platform, arch);
  // Check offline inputs before any extraction, executable or installation mutation.
  if (archiveFile) await verifyAnvilFile(archiveFile, release.archiveSha256);
  await mkdir(destinationDir, { recursive: true, mode: 0o755 });
  const binary = join(destinationDir, "anvil"),
    wrapper = join(destinationDir, "anvil-fork");
  let valid = false;
  try {
    await verifyAnvilFile(binary, release.binarySha256);
    executable(binary);
    valid = true;
  } catch {}
  if (!valid) {
    const scratch = await mkdtemp(join(destinationDir, ".install-"));
    try {
      const archive = archiveFile ?? join(scratch, release.filename);
      if (!archiveFile) await download(archive);
      await verifyAnvilFile(archive, release.archiveSha256);
      // Extract only the exact regular binary from the checksum-verified release.
      execFileSync(
        "tar",
        [
          "--no-same-owner",
          "--no-same-permissions",
          "-xzf",
          archive,
          "-C",
          scratch,
          "anvil",
        ],
        { timeout: 30000, maxBuffer: 4096, stdio: "ignore" },
      );
      const candidate = join(scratch, "anvil");
      await verifyAnvilFile(candidate, release.binarySha256);
      await chmod(candidate, 0o755);
      executable(candidate);
      await rename(candidate, binary);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  await copyFile(join(scripts, "anvil-fork.sh"), wrapper);
  await chmod(wrapper, 0o755);
  executable(wrapper);
  return wrapper;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && !(args.length === 2 && args[0] === "--archive"))
      throw new Error(
        "Usage: node scripts/install-anvil.mjs [--archive /verified/release.tar.gz]",
      );
    const path = await installAnvil({ archiveFile: args[1] });
    process.stdout.write(`Verified Anvil ${release.version}: ${path}\n`);
  } catch (error) {
    // Never print download URLs from errors or environment variables/credentials.
    process.stderr.write(
      `Anvil runtime installation failed: ${error instanceof Error && /checksum|regular file|Linux x64|Usage:|version mismatch/.test(error.message) ? error.message : "official artifact or executable unavailable"}\n`,
    );
    process.exitCode = 1;
  }
}

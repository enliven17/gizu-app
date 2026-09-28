const { Buffer } = require("node:buffer");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Pin both the release and bytes; no formatter binaries enter the repository.
const version = "0.54";
const checksum = "5e7eb28a0b2006d1cefbc9213bfc73a8191ec2f85d639ec4fc4ec0cd04212e82";
const url = `https://repo.maven.apache.org/maven2/com/facebook/ktfmt/${version}/ktfmt-${version}-jar-with-dependencies.jar`;
const sourceRoot = path.resolve(__dirname, "../modules/gizu-stored-signer/android/src");

async function kotlinFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return kotlinFiles(file);
      return entry.isFile() && entry.name.endsWith(".kt") ? [file] : [];
    }),
  );
  return files.flat().sort();
}

async function formatterJar() {
  const cache = path.join(os.tmpdir(), "gizu-kotlin-formatter");
  const jar = path.join(cache, `ktfmt-${version}.jar`);
  const matches = (bytes) => createHash("sha256").update(bytes).digest("hex") === checksum;
  try {
    if (matches(await fs.readFile(jar))) return jar;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(`Downloading pinned ktfmt ${version}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Formatter download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error("Formatter checksum mismatch");
  await fs.mkdir(cache, { recursive: true });
  const temporary = `${jar}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, jar);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return jar;
}

async function main() {
  const mode = process.argv[2];
  if (!["check", "write"].includes(mode) || process.argv.length !== 3)
    throw new Error("Expected check or write");
  const java = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";
  // Limit scope to maintained Kotlin; generated bindings and the retained legacy module are excluded.
  const files = await kotlinFiles(sourceRoot);
  const jar = await formatterJar();
  const flags = ["--google-style", "--do-not-remove-unused-imports"];
  if (mode === "check") flags.push("--dry-run", "--set-exit-if-changed");
  const result = spawnSync(java, ["-jar", jar, ...flags, ...files], { stdio: "inherit" });
  if (result.error)
    throw new Error(
      `Cannot run Kotlin formatter. Configure JDK 17 via JAVA_HOME. ${result.error.message}`,
    );
  process.exitCode = result.status ?? 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

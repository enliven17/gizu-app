import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveEnv } from "../../src/secret/env-file.ts";

test("uses process environment when the env file is absent", () => {
  const missingDirectory = join(tmpdir(), `gizu-missing-env-${randomUUID()}`);

  assert.equal(resolveEnv(missingDirectory), process.env);
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

it("runs the packaged action in Node with real inputs and archive creation", () => {
  const bundle = resolve("dist/index.cjs");
  const root = mkdtempSync(join(tmpdir(), "publish-bundle-"));
  try {
    writeFileSync(join(root, ".pumproom.yml"), "repo:\n  name: test\n");
    const preload = join(root, "mock-fetch.mjs");
    writeFileSync(
      preload,
      `
      import assert from 'node:assert/strict';
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        if (calls === 1) {
          assert.ok(url.endsWith('/schema/configs'));
          return new Response('{}');
        }
        assert.equal(calls, 2);
        assert.ok(url.endsWith('/upload/sync_repo'));
        assert.equal(init.body.get('source_ref'), ' git:course ');
        assert.equal(init.body.get('realm'), 'test');
        assert.ok(init.body.get('archive').size > 0);
        return Response.json({pushed_at: 'now', tasks_uploaded: 0, tasks_created: 0,
          tasks_updated: 0, tasks_deleted: 0, tasks_restored: 0, tasks_unchanged: 0,
          tasks_skipped: 0, skipped: []});
      };
      process.on('exit', () => assert.equal(calls, 2));
    `,
    );
    const output = execFileSync(
      process.execPath,
      ["--import", pathToFileURL(preload).href, bundle],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          INPUT_ROOT_DIR: root,
          INPUT_IGNORE: "mock-fetch.mjs",
          INPUT_REALM: "test",
          INPUT_REPO_NAME: "test",
          INPUT_API_KEY: "test-only",
          INPUT_SOURCE_REF: " git:course ",
        },
      },
    );
    expect(output).toContain("successfully registered");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

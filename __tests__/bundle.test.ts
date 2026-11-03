import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

it.each(["success", "warning", "failure"])(
  "runs the packaged action in Node and writes a %s report with real GitHub files",
  (outcome) => {
    const bundle = resolve("dist/index.cjs");
    const root = mkdtempSync(join(tmpdir(), "publish-bundle-"));
    try {
      writeFileSync(join(root, "summary.html"), "");
      writeFileSync(join(root, "outputs.txt"), "");
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
        if (process.env.MOCK_OUTCOME === 'failure') {
          return Response.json({ detail: 'Rejected test-only key' }, { status: 403 });
        }
        const skipped = process.env.MOCK_OUTCOME === 'warning'
          ? [{name: '<manual>', reason: 'managed_by_admin'}] : [];
        return Response.json({pushed_at: '2026-11-03T12:00:00Z', tasks_uploaded: skipped.length,
          tasks_created: 0, tasks_updated: 0, tasks_archived: 0, tasks_unchanged: 0,
          tasks_skipped: skipped.length, skipped});
      };
      process.on('exit', () => assert.equal(calls, 2));
    `,
      );
      const processResult = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(preload).href, bundle],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            INPUT_ROOT_DIR: root,
            INPUT_IGNORE: "mock-fetch.mjs,summary.html,outputs.txt",
            GITHUB_STEP_SUMMARY: join(root, "summary.html"),
            GITHUB_OUTPUT: join(root, "outputs.txt"),
            INPUT_REALM: "test",
            INPUT_REPO_NAME: "test",
            INPUT_API_KEY: "test-only",
            INPUT_SOURCE_REF: " git:course ",
            MOCK_OUTCOME: outcome,
          },
        },
      );
      expect(processResult.error).toBeUndefined();
      expect(processResult.status).toBe(outcome === "failure" ? 1 : 0);
      const summary = readFileSync(join(root, "summary.html"), "utf8");
      const outputs = readFileSync(join(root, "outputs.txt"), "utf8");
      expect(outputs).toMatch(new RegExp(`status<<[^\\n]+\\n${outcome}`));
      expect(summary).not.toContain("test-only");
      if (outcome === "failure") {
        expect(summary).toContain("Publication failed");
        expect(summary).toContain("HTTP 403");
        expect(summary).toContain("Rejected *** key");
        expect(summary).toContain("No confirmed publication result");
        expect(outputs).not.toContain("tasks_created");
      } else {
        expect(processResult.stdout).toContain("successfully registered");
        expect(summary).toContain(
          outcome === "warning" ? "Published with skipped tasks" : "✅ Published",
        );
        expect(summary).toContain("Archived");
        if (outcome === "warning") {
          expect(summary).toContain("&lt;manual&gt;");
          expect(summary).toContain("managed_by_admin");
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

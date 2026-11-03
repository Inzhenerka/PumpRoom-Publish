import { vi } from "vitest";

import * as core from "../__fixtures__/core.js";
import { parsePumpRoomResponse } from "../src/main.js";
import type { PumpRoomApiResponse } from "../src/main.js";
import { formatPublishReport, writePublishReport } from "../src/report.js";

vi.mock("@actions/core", () => import("../__fixtures__/core.js"));

const result: PumpRoomApiResponse = {
  pushed_at: "2026-11-03T12:00:00Z",
  tasks_uploaded: 5,
  tasks_created: 1,
  tasks_updated: 2,
  tasks_archived: 3,
  tasks_unchanged: 1,
  tasks_skipped: 1,
  skipped: [{ name: "task", reason: "protected" }],
};

it("accepts the current API result, including archived tasks", () => {
  expect(parsePumpRoomResponse(JSON.stringify(result))).toEqual(result);
});

it.each([
  {},
  null,
  [],
  { ...result, tasks_archived: undefined },
  { ...result, tasks_updated: -1 },
  { ...result, tasks_created: "1" },
  { ...result, tasks_skipped: 0 },
  { ...result, skipped: [null] },
  { ...result, pushed_at: "invalid" },
  { ...result, tasks_updated: 0.5 },
])("rejects malformed publication results: %j", (data) => {
  expect(() => parsePumpRoomResponse(JSON.stringify(data))).toThrow();
});

it("escapes untrusted content and redacts secrets in summaries", () => {
  const html = formatPublishReport(
    {
      status: "failure",
      stage: "Upload",
      startedAt: Date.now(),
      sourceRef: "<script>key&</script>",
      error: "failed key <img>",
      result: { ...result, skipped: [{ name: "<b>key</b>", reason: "key & protected" }] },
    },
    "key",
  );
  expect(html).not.toContain("key");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img>");
  expect(html).toContain("&lt;b&gt;***&lt;/b&gt;");
  expect(html).toContain("No confirmed publication result");
});

it("bounds large skipped-task summaries below GitHub's 1 MiB limit", () => {
  const html = formatPublishReport({
    status: "warning",
    stage: "Completed",
    startedAt: Date.now(),
    result: {
      ...result,
      tasks_skipped: 1_000,
      skipped: Array.from({ length: 1_000 }, () => ({
        name: '"'.repeat(1_000),
        reason: '"'.repeat(1_000),
      })),
    },
  });
  expect(Buffer.byteLength(html)).toBeLessThan(1_024 * 1_024);
  expect(html).toContain("first 100");
});

it("still writes the summary when setting outputs fails", async () => {
  core.setOutput.mockImplementationOnce(() => {
    throw new Error("Output unavailable");
  });
  core.summary.addRaw.mockReturnThis();
  core.summary.write.mockResolvedValue(undefined);
  await writePublishReport(
    { status: "success", stage: "Completed", startedAt: Date.now(), result },
    "",
  );
  expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Output unavailable"));
  expect(core.summary.write).toHaveBeenCalled();
});

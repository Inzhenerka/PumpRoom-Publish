import * as core from "@actions/core";

import type { PumpRoomApiResponse } from "./main.js";

export const taskMetrics = [
  ["tasks_uploaded", "Uploaded (snapshot)"],
  ["tasks_created", "Created"],
  ["tasks_updated", "Updated"],
  ["tasks_archived", "Archived"],
  ["tasks_unchanged", "Unchanged"],
  ["tasks_skipped", "Skipped"],
] as const;

export interface PublishReport {
  status: "success" | "warning" | "failure";
  stage: string;
  realm?: string;
  repoName?: string;
  sourceRef?: string;
  result?: PumpRoomApiResponse;
  error?: string;
  startedAt: number;
}

export function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join("***") : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPublishReport(report: PublishReport, secret = ""): string {
  const safe = (value: string, limit = 8_000) => escapeHtml(redact(value, secret).slice(0, limit));
  const row = (name: string, value: string) => `<tr><td>${name}</td><td>${safe(value)}</td></tr>`;
  const labels = {
    success: "✅ Published",
    warning: "⚠️ Published with skipped tasks",
    failure: "❌ Publication failed",
  };
  let html = `<h2>PumpRoom Publish — ${labels[report.status]}</h2>\n<table>`;
  for (const [name, value] of [
    ["Realm", report.realm],
    ["Repository", report.repoName],
    ["Source", report.sourceRef],
    ["Commit", process.env.GITHUB_SHA],
    ["Stage", report.stage],
    ["Duration", `${((Date.now() - report.startedAt) / 1_000).toFixed(1)} s`],
  ]) {
    if (value) html += row(name!, redact(value, secret).slice(0, 4_000));
  }
  html += "</table>\n";
  if (report.result) {
    html += `<h3>Tasks</h3><table>${row("Pushed at", report.result.pushed_at)}`;
    for (const [key, label] of taskMetrics) html += row(label, String(report.result[key]));
    html +=
      "</table>\n<p>Uploaded is the snapshot size, including unchanged and skipped tasks.</p>";
    if (report.result.skipped.length) {
      html += "<h3>Skipped tasks</h3><table><tr><th>Task</th><th>Reason</th></tr>";
      // Leave room below GitHub's 1 MiB per-step summary limit, even for large snapshots.
      for (const item of report.result.skipped.slice(0, 100)) {
        html += row(safe(item.name, 500), redact(item.reason, secret).slice(0, 500));
      }
      html += "</table>";
      if (report.result.skipped.length > 100) {
        html += "<p>Showing the first 100 skipped tasks; the full list is in the step logs.</p>";
      }
    }
  }
  if (report.error) html += `<h3>Error</h3><pre>${safe(report.error)}</pre>\n`;
  if (report.status === "failure" && report.stage === "Upload") {
    html +=
      "<p>No confirmed publication result was received. A timeout, network error, server error, " +
      "or invalid response may occur after the server has applied changes. " +
      "Check PumpRoom before rerunning. This action does not retry uploads automatically.</p>";
  }
  return html;
}

export async function writePublishReport(report: PublishReport, secret: string): Promise<void> {
  // Output/summary failures must not replace the result of the publication itself.
  try {
    core.setOutput("status", report.status);
    core.setOutput("failed_stage", report.status === "failure" ? report.stage : "");
    if (report.result) {
      core.setOutput(
        "result",
        JSON.stringify(report.result, (_key, value: unknown) =>
          typeof value === "string" ? redact(value, secret) : value,
        ),
      );
      for (const [key] of taskMetrics) core.setOutput(key, report.result[key]);
    }
  } catch (error) {
    core.warning(`Unable to write publication outputs: ${redact(String(error), secret)}`);
  }
  try {
    await core.summary.addRaw(formatPublishReport(report, secret)).write();
  } catch (error) {
    core.summary.emptyBuffer();
    core.warning(`Unable to write GitHub summary: ${redact(String(error), secret)}`);
  }
}

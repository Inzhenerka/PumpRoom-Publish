import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as core from "@actions/core";
import AdmZip from "adm-zip";

import { postWithTimeout } from "./http.js";
import { redact, taskMetrics, writePublishReport } from "./report.js";
import type { PublishReport } from "./report.js";

const VALIDATE_URL = "https://pumproom-api.inzhenerka-cloud.com/schema/configs";
const UPLOAD_URL = "https://pumproom-api.inzhenerka-cloud.com/upload/sync_repo";

export function resolveSourceRef(override: string): string {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!override && !repository) throw new Error("source_ref or GITHUB_REPOSITORY is required");
  if (override) return override;
  const url = new URL(`${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}`);
  url.pathname = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  return url.href.replace(/\/$/, "");
}

export interface PumpRoomApiResponse {
  pushed_at: string;
  tasks_uploaded: number;
  tasks_created: number;
  tasks_updated: number;
  tasks_archived: number;
  tasks_unchanged: number;
  tasks_skipped: number;
  skipped: { name: string; reason: string }[];
}

export function formatPumpRoomResponse(response: PumpRoomApiResponse): string {
  const formattedDate = new Date(response.pushed_at).toLocaleString();
  return `
📊 PumpRoom Repository Update Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕒 Pushed At: ${formattedDate}

📋 Tasks Summary:
  • Uploaded: ${response.tasks_uploaded}
  • Created: ${response.tasks_created}
  • Updated: ${response.tasks_updated}
  • Archived: ${response.tasks_archived}
  • Unchanged: ${response.tasks_unchanged}
  • Skipped: ${response.tasks_skipped}
${response.skipped.map((item) => `    - ${item.name}: ${item.reason}`).join("\n")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parsePumpRoomResponse(body: string): PumpRoomApiResponse {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("API returned invalid JSON; publication could not be confirmed.");
  }
  if (!data || typeof data !== "object")
    throw new Error("API returned an invalid publication result.");
  const result = data as Record<string, unknown>;
  if (
    typeof result.pushed_at !== "string" ||
    !Number.isFinite(Date.parse(result.pushed_at)) ||
    taskMetrics.some(
      ([key]) => !Number.isSafeInteger(result[key]) || (result[key] as number) < 0,
    ) ||
    !Array.isArray(result.skipped) ||
    result.skipped.some(
      (item: unknown) =>
        !item ||
        typeof item !== "object" ||
        !("name" in item) ||
        typeof item.name !== "string" ||
        !("reason" in item) ||
        typeof item.reason !== "string",
    ) ||
    result.tasks_skipped !== result.skipped.length
  ) {
    throw new Error(
      "API returned an incomplete or invalid publication result; check API/Action compatibility.",
    );
  }
  return data as PumpRoomApiResponse;
}

export async function validateUniqueFolderNames(rootDir: string): Promise<void> {
  core.info("🔍 Validating unique folder names...");

  const folders = fs
    .readdirSync(rootDir)
    .filter((item) => fs.statSync(path.join(rootDir, item)).isDirectory());

  if (folders.length === 0) {
    core.info("ℹ️ No folders found to validate");
    return;
  }

  const seen = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  for (const folder of folders) {
    const key = folder.toLowerCase();
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, folder);
    } else {
      const variants = duplicates.get(key) ?? [existing];
      variants.push(folder);
      duplicates.set(key, variants);
    }
  }

  if (duplicates.size > 0) {
    let errorMessage = "❌ Folder duplicates found:\n";
    for (const [key, variants] of duplicates) {
      errorMessage += `  • ${key} (variants: ${variants.join(", ")})\n`;
    }
    throw new Error(errorMessage);
  }

  core.info("✅ No folder duplicates found");
}

export async function validatePumproomYml(rootDir: string): Promise<void> {
  core.info("🔍 Validating .pumproom.yml...");

  const configPath = path.join(rootDir, ".pumproom.yml");
  if (!fs.existsSync(configPath)) {
    throw new Error("❌ .pumproom.yml file not found");
  }

  const configContent = fs.readFileSync(configPath, "utf8");

  try {
    await postWithTimeout(
      VALIDATE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_yml: configContent }),
      },
      60_000,
    );
  } catch (error) {
    throw new Error(`❌ Configuration validation failed:\nError: ${toErrorMessage(error)}\n`, {
      cause: error,
    });
  }

  core.info("✅ Configuration is valid");
}

export async function run(): Promise<void> {
  const report: PublishReport = { status: "failure", stage: "Inputs", startedAt: Date.now() };
  let apiKey = "";
  try {
    const rootDir = core.getInput("root_dir") || process.cwd();
    const ignoreInput = core.getInput("ignore") || "";
    apiKey = core.getInput("api_key", { required: true });
    core.setSecret(apiKey);
    const realm = core.getInput("realm", { required: true });
    report.realm = realm;
    const repoName = core.getInput("repo_name", { required: true });
    report.repoName = repoName;
    const sourceRef = resolveSourceRef(core.getInput("source_ref", { trimWhitespace: false }));
    report.sourceRef = sourceRef;

    const ignoreList = [".git", ".github", ".claude"];
    if (ignoreInput) {
      ignoreList.push(...ignoreInput.split(",").map((item) => item.trim()));
    }

    core.debug(`Root directory: ${rootDir}`);
    core.debug(`Ignore list: ${ignoreList.join(", ")}`);

    report.stage = "Folder validation";
    await validateUniqueFolderNames(rootDir);
    report.stage = "Configuration validation";
    await validatePumproomYml(rootDir);

    const tempZipPath = path.join(os.tmpdir(), `pumproom-${Date.now()}-${process.pid}.zip`);
    try {
      report.stage = "Archive creation";
      await createZipArchive(rootDir, tempZipPath, ignoreList);
      report.stage = "Upload";
      report.result = await uploadArchive(tempZipPath, realm, repoName, apiKey, sourceRef);
      report.status = report.result.tasks_skipped ? "warning" : "success";
      report.stage = "Completed";
    } finally {
      try {
        if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
      } catch {
        // best-effort cleanup
      }
    }

    core.info("✅ Repository successfully published to PumpRoom");
  } catch (error) {
    report.error = redact(toErrorMessage(error), apiKey);
    core.setFailed(`${report.stage}: ${report.error}`);
  } finally {
    await writePublishReport(report, apiKey);
  }
}

export async function createZipArchive(
  sourceDir: string,
  outputPath: string,
  ignoreList: string[],
): Promise<void> {
  core.info("Creating ZIP archive...");

  const zip = new AdmZip();

  function addFilesToZip(currentPath: string, relativePath: string = ""): void {
    for (const item of fs.readdirSync(currentPath)) {
      const itemPath = path.join(currentPath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;

      // Match by path segment, not substring — so `.git` doesn't accidentally
      // exclude `.gitignore`, and a user-supplied `src` doesn't exclude every
      // path containing the letters "src".
      const segments = itemRelativePath.split(/[/\\]/);
      if (ignoreList.some((ignore) => segments.includes(ignore))) {
        core.debug(`Ignoring: ${itemPath}`);
        continue;
      }

      if (fs.statSync(itemPath).isDirectory()) {
        addFilesToZip(itemPath, itemRelativePath);
      } else {
        core.debug(`Adding file: ${itemPath} as ${itemRelativePath}`);
        zip.addLocalFile(itemPath, path.dirname(itemRelativePath), path.basename(itemRelativePath));
      }
    }
  }

  addFilesToZip(sourceDir);

  zip.writeZip(outputPath);
  core.info(`ZIP archive created at: ${outputPath}`);
}

// Reconcile only source-managed tasks with this exact source reference.
export async function uploadArchive(
  zipPath: string,
  realm: string,
  repoName: string,
  apiKey: string,
  sourceRef: string,
): Promise<PumpRoomApiResponse> {
  core.info("Uploading archive to PumpRoom...");

  const buffer = fs.readFileSync(zipPath);
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/zip" });

  const formData = new FormData();
  formData.append("realm", realm);
  formData.append("repo_name", repoName);
  formData.append("force_update", "false");
  formData.append("source_ref", sourceRef);
  formData.append("archive", blob, path.basename(zipPath));

  let body: string;
  try {
    body = await postWithTimeout(
      UPLOAD_URL,
      {
        method: "POST",
        headers: { "X-API-KEY": apiKey },
        body: formData,
      },
      600_000,
    );
  } catch (error) {
    throw new Error(`Unable to upload archive: ${redact(toErrorMessage(error), apiKey)}`, {
      cause: error,
    });
  }

  const data = parsePumpRoomResponse(body);
  core.info(redact(formatPumpRoomResponse(data), apiKey));
  if (data.tasks_skipped)
    core.warning(
      `${data.tasks_skipped} task(s) skipped; see names and reasons in the publication summary`,
    );
  core.info("✅ Repo and tasks successfully registered");
  return data;
}

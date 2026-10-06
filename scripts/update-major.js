import { execFileSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error("Expected a stable release version (major.minor.patch)");
}
const branch = `v${version.split(".")[0]}`;
// Push the released tag's commit; never force-update existing major branches.
execFileSync("git", ["push", "origin", `refs/tags/v${version}^{}:refs/heads/${branch}`], {
  stdio: "inherit",
});

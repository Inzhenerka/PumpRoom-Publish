import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";

const script = resolve("scripts/update-major.js");
it("publishes the tagged commit, preserves v2 and refuses non-fast-forward updates", () => {
  const root = mkdtempSync(join(tmpdir(), "publish-release-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const publish = () =>
    execFileSync(process.execPath, [script, "3.0.0"], { cwd: root, stdio: "pipe" });
  try {
    git("init", "--bare", "remote.git");
    git("init", "-b", "main");
    git("config", "user.name", "Release Test");
    git("config", "user.email", "test@example.invalid");
    git("remote", "add", "origin", join(root, "remote.git"));
    git("commit", "--allow-empty", "-m", "initial");
    const old = git("rev-parse", "HEAD");
    git("push", "origin", "HEAD:refs/heads/v2");
    git("commit", "--allow-empty", "-m", "release");
    const release = git("rev-parse", "HEAD");
    git("tag", "-a", "v3.0.0", "-m", "release");
    git("commit", "--allow-empty", "-m", "later work");
    publish();
    expect(git("--git-dir=remote.git", "rev-parse", "v3")).toBe(release);
    expect(git("--git-dir=remote.git", "rev-parse", "v2")).toBe(old);
    publish(); // Repeating the release branch update is harmless.
    git("push", "origin", "HEAD:refs/heads/v3");
    const newer = git("rev-parse", "HEAD");
    expect(publish).toThrow();
    expect(git("--git-dir=remote.git", "rev-parse", "v3")).toBe(newer);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

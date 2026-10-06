import { vi } from "vitest";
import type { Mock } from "vitest";

import * as core from "../__fixtures__/core.js";
import * as fs from "../__fixtures__/fs.js";
import * as path from "../__fixtures__/path.js";

vi.mock("@actions/core", () => import("../__fixtures__/core.js"));
vi.mock("fs", () => import("../__fixtures__/fs.js"));
vi.mock("os", () => import("../__fixtures__/os.js"));
vi.mock("path", () => import("../__fixtures__/path.js"));
vi.mock("adm-zip", async () => ({ default: (await import("../__fixtures__/adm-zip.js")).admZip }));

const fetchMock = vi.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
globalThis.fetch = fetchMock as unknown as typeof fetch;

let validateUniqueFolderNames: (rootDir: string) => Promise<void>;
let validatePumproomYml: (rootDir: string) => Promise<void>;
let run: () => Promise<void>;

beforeAll(async () => {
  const mainModule = await import("../src/main.js");
  validateUniqueFolderNames = mainModule.validateUniqueFolderNames;
  validatePumproomYml = mainModule.validatePumproomYml;
  run = mainModule.run;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Edge cases in validateUniqueFolderNames", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (path.join as Mock).mockImplementation((...args: unknown[]) => (args as string[]).join("/"));
  });

  it("propagates non-Error throws as-is", async () => {
    (fs.readdirSync as Mock).mockImplementation(() => {
      throw "Not an Error object";
    });

    await expect(validateUniqueFolderNames("/mock/dir")).rejects.toBe("Not an Error object");
  });
});

describe("Edge cases in validatePumproomYml", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (path.join as Mock).mockImplementation((...args: unknown[]) => (args as string[]).join("/"));
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue("valid: yaml\ncontent: true");
    fetchMock.mockReset();
  });

  it("reports network errors with the original message", async () => {
    fetchMock.mockRejectedValue(new Error("Network Error"));

    await expect(validatePumproomYml("/mock/dir")).rejects.toThrow(
      "❌ Configuration validation failed:\nError: Network Error",
    );
  });

  it("coerces non-Error rejections to a string message", async () => {
    fetchMock.mockRejectedValue("Not an Error object");

    await expect(validatePumproomYml("/mock/dir")).rejects.toThrow(
      "❌ Configuration validation failed:\nError: Not an Error object",
    );
  });
});

describe("Edge cases in run function", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (core.getInput as Mock).mockImplementation((name: unknown) => {
      switch (name as string) {
        case "root_dir":
          return "";
        case "ignore":
          return "";
        case "realm":
          return "test-realm";
        case "repo_name":
          return "test-repo";
        case "source_ref":
          return "https://github.com/example/tasks";
        case "api_key":
          return "test-api-key";
        default:
          return "";
      }
    });
    vi.spyOn(process, "cwd").mockReturnValue("/mock/cwd");
  });

  it("falls back to process.cwd() when root_dir is empty", async () => {
    (fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error("Test error");
    });

    await run();

    expect(core.debug).toHaveBeenCalledWith("Root directory: /mock/cwd");
  });

  it("uses only default ignore list when no user input", async () => {
    (fs.readdirSync as Mock).mockImplementation(() => {
      throw new Error("Test error");
    });

    await run();

    expect(core.debug).toHaveBeenCalledWith("Ignore list: .git, .github, .claude");
  });

  it("passes non-Error throws into core.setFailed", async () => {
    (fs.readdirSync as Mock).mockImplementation(() => {
      throw "Not an Error object";
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith("Not an Error object");
  });
});

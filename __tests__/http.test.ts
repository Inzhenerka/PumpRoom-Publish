import { vi } from "vitest";

import { postWithTimeout } from "../src/http.js";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
});

it("keeps the timeout active while reading a stalled response body", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    async (_url, init) =>
      ({
        ok: true,
        text: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      }) as Response,
  );
  const request = postWithTimeout("https://example.invalid", {}, 1_000);
  const assertion = expect(request).rejects.toThrow("Request timed out after 1 seconds");
  await vi.advanceTimersByTimeAsync(1_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the timer after a network error without retrying", async () => {
  vi.useFakeTimers();
  fetchMock.mockRejectedValue(new Error("Network unavailable"));
  await expect(postWithTimeout("https://example.invalid", {}, 1_000)).rejects.toThrow(
    "Network unavailable",
  );
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([401, 403, 413, 422, 429, 500, 503])(
  "reports HTTP %s with safe API details",
  async (status) => {
    fetchMock.mockResolvedValue(Response.json({ detail: "Request rejected" }, { status }));
    await expect(postWithTimeout("https://example.invalid", {}, 1_000)).rejects.toThrow(
      `HTTP ${status}\nRequest rejected`,
    );
  },
);

it("bounds unexpected proxy error bodies", async () => {
  fetchMock.mockResolvedValue(new Response("x".repeat(10_000), { status: 502 }));
  await expect(postWithTimeout("https://example.invalid", {}, 1_000)).rejects.toThrow(
    /^HTTP 502\nx{4000}\n/,
  );
});

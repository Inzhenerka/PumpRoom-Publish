const MAX_DETAIL_LENGTH = 4_000;

function errorDetail(body: string): string {
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === "object" && "detail" in data) {
      const detail = data.detail;
      if (typeof detail === "string") return detail.slice(0, MAX_DETAIL_LENGTH);
      if (Array.isArray(detail)) {
        // FastAPI validation errors can also contain input values and context.
        return detail
          .map((item) => {
            if (!item || typeof item !== "object") return "Invalid value";
            const location = Array.isArray(item.loc) ? item.loc.join(".") : "configuration";
            return `${location}: ${typeof item.msg === "string" ? item.msg : "Invalid value"}`;
          })
          .join("\n")
          .slice(0, MAX_DETAIL_LENGTH);
      }
    }
  } catch {
    // A proxy may return plain text or HTML instead of API JSON.
  }
  return body.trim().slice(0, MAX_DETAIL_LENGTH) || "No error details returned";
}

function httpHint(status: number): string {
  if (status === 401 || status === 403) return "Check api_key and its access to the target realm.";
  if (status === 413) return "Reduce the archive size or update the ignore input.";
  if (status === 422) return "Check .pumproom.yml and the reported fields.";
  if (status === 429) return "The API is rate limited. Wait before trying again.";
  if (status >= 500) return "The API or proxy failed. Check the service before trying again.";
  return "";
}

export async function postWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Keep the deadline active until the body has been consumed, too.
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        [`HTTP ${response.status}`, errorDetail(body), httpHint(response.status)]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${timeoutMs / 1_000} seconds.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const API_BASE_URL = process.env.PINTEREST_API_BASE_URL ?? "https://api.pinterest.com/v5";

export const CHARACTER_LIMIT = 25_000;

function httpErrorMessage(status: number, detail?: string): string {
  const suffix = detail ? ` Pinterest said: ${detail}` : "";
  switch (status) {
    case 401:
      return `Pinterest rejected the access token. It may be expired or missing scopes; generate a new PINTEREST_ACCESS_TOKEN.${suffix}`;
    case 403:
      return `Permission denied. The token lacks the required scope (e.g. boards:write, pins:write), or the app is on Trial access, which cannot write publicly.${suffix}`;
    case 404:
      return `Not found. Check the ID; pinterest_list_boards and pinterest_list_pins return valid IDs.${suffix}`;
    case 429:
      return `Pinterest rate limit exceeded. Wait a minute before making more requests.${suffix}`;
    default:
      return `The Pinterest API returned HTTP ${status}.${suffix}`;
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(httpErrorMessage(status, detail));
  }
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { params?: Record<string, string | number | undefined>; body?: unknown; signal: AbortSignal }
): Promise<T> {
  const token = process.env.PINTEREST_ACCESS_TOKEN;
  if (!token) {
    throw new Error("PINTEREST_ACCESS_TOKEN is not set. See the README for how to get a token.");
  }
  const url = new URL(`${API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Pinterest did not respond within 30 seconds. Try again.");
    }
    throw error;
  }
  if (!response.ok) {
    let detail: string | undefined;
    try {
      detail = ((await response.json()) as { message?: string }).message;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * The only way the web app talks to the API. Every failure becomes an ApiError carrying the server's
 * error code (never a sentence) so the UI can say it in the user's language next to the thing that failed.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public params: Record<string, unknown> = {},
    public fields: Record<string, string> = {},
  ) {
    super(code);
  }
}

type Body = unknown;

async function request<T>(method: string, path: string, body?: Body, raw?: Blob | ArrayBuffer): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch", Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (raw !== undefined) {
    payload = raw;
    headers["Content-Type"] = "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network.offline");
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && e?.code === "auth.required") window.dispatchEvent(new Event("auth:lost"));
    throw new ApiError(res.status, e?.code ?? "http.error", e?.params ?? {}, e?.fields ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: Body) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: Body) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body ?? {}),
  del: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, file: Blob) => request<T>("POST", path, undefined, file),
};

/** Builds "?a=1&b=x", skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

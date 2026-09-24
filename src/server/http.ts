import { permanent, retryable } from "./jobs/errors";

export type PermanentCodes = Partial<Record<number, string>>;

// One outbound HTTP call for a job. Network failures, timeouts, 408, 429 and 5xx are retryable;
// other 4xx mean our request or configuration is wrong and retrying won't help. The caller
// maps specific statuses (e.g. 404 from a deleted webhook) to readable codes.
export async function send(
  service: string,
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; permanentCodes?: PermanentCodes } = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000) });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw retryable(
      timedOut ? `${service}_timeout` : `${service}_unreachable`,
      timedOut ? `${service} did not respond in time` : `Could not reach ${service}`,
    );
  }

  if (res.ok) return res;

  const detail = await describe(res);
  if (res.status === 429) {
    throw retryable(
      `${service}_rate_limited`,
      `${service} rate limited the request`,
      429,
      await retryAfterMs(res),
    );
  }
  if (res.status >= 500 || res.status === 408) {
    throw retryable(
      `${service}_unavailable`,
      `${service} returned ${res.status}${detail}`,
      res.status,
    );
  }
  const code = opts.permanentCodes?.[res.status] ?? `${service}_rejected`;
  throw permanent(code, `${service} returned ${res.status}${detail}`, res.status);
}

async function describe(res: Response) {
  try {
    const text = (await res.clone().text()).slice(0, 200).replace(/\s+/g, " ").trim();
    return text ? `: ${text}` : "";
  } catch {
    return "";
  }
}

async function retryAfterMs(res: Response): Promise<number | undefined> {
  const header = res.headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  try {
    // Discord puts a more precise value in the body.
    const body = (await res.clone().json()) as { retry_after?: number };
    if (typeof body.retry_after === "number") return Math.ceil(body.retry_after * 1000);
  } catch {}
  return undefined;
}

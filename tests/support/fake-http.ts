import { vi } from "vitest";

type Reply = {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  // Behave as if the request's AbortSignal.timeout fired.
  timeout?: boolean;
};
type Responder =
  | Reply
  | ((req: { url: string; body: unknown; method: string }) => Reply | Promise<Reply>);

type Route = { match: RegExp; replies: Responder[]; sticky: Responder };

export type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

// Stands in for the outside world at the fetch boundary. Each route answers with its queued
// replies in order, then keeps repeating the last one.
export function fakeHttp() {
  const routes: Route[] = [];
  const calls: Call[] = [];

  const on = (match: RegExp, ...replies: Responder[]) => {
    const existing = routes.find((r) => r.match.source === match.source);
    if (existing) {
      existing.replies = replies.slice(0, -1);
      existing.sticky = replies[replies.length - 1];
    } else {
      routes.push({ match, replies: replies.slice(0, -1), sticky: replies[replies.length - 1] });
    }
  };

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {}
    } else if (body instanceof URLSearchParams) {
      body = Object.fromEntries(body);
    }
    calls.push({ method, url, body, headers: Object.fromEntries(new Headers(init?.headers)) });

    const route = routes.find((r) => r.match.test(url));
    if (!route) throw new TypeError(`fetch failed: no fake route for ${method} ${url}`);
    const responder = route.replies.shift() ?? route.sticky;
    const reply =
      typeof responder === "function" ? await responder({ url, body, method }) : responder;
    if (reply.timeout)
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (reply.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, reply.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("The operation timed out.", "TimeoutError"));
        });
      });
    }
    const payload = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? "");
    return new Response(payload, {
      status: reply.status ?? 200,
      headers: {
        "content-type": reply.json !== undefined ? "application/json" : "text/plain",
        ...reply.headers,
      },
    });
  });

  vi.stubGlobal("fetch", fetchImpl);
  return {
    on,
    calls,
    callsTo: (match: RegExp) => calls.filter((c) => match.test(c.url)),
  };
}

export const GROQ = /api\.groq\.com/;
export const DISCORD_EDIT = /\/webhooks\/\d+\/[^/]+\/messages\/@original$/;
export const DISCORD_POST = /\/channels\/\d+\/messages$/;
export const SLACK = /hooks\.slack\.com/;
export const DISCORD_WEBHOOK = /discord\.com\/api\/webhooks\//;

export function groqReply(content: unknown): Reply {
  return {
    json: {
      choices: [
        { message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
      ],
    },
  };
}

export const goodTriage = {
  summary: "Members in the main voice channel are disconnected every few minutes.",
  category: "bug",
  severity: "high",
  tags: ["voice", "disconnects"],
  next_step: "Check the voice region and recent bot changes.",
};

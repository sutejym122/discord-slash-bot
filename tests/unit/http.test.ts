import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send } from "@/server/http";
import { JobError } from "@/server/jobs/errors";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const status = Number(req.url?.slice(1).split("?")[0]) || 200;
    if (req.url?.includes("slow")) return void setTimeout(() => res.end("late"), 2_000);
    if (status === 429) res.setHeader("retry-after", "7");
    res.statusCode = status;
    res.end(status === 404 ? "no_service" : "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function failure(path: string, timeoutMs?: number) {
  try {
    await send("svc", `${base}/${path}`, {}, { timeoutMs, permanentCodes: { 404: "svc_gone" } });
  } catch (e) {
    return e as JobError;
  }
  throw new Error("expected send to fail");
}

describe("send", () => {
  it("classifies upstream responses", async () => {
    expect(await failure("503")).toMatchObject({
      retryable: true,
      code: "svc_unavailable",
      httpStatus: 503,
    });
    expect(await failure("429")).toMatchObject({
      retryable: true,
      code: "svc_rate_limited",
      retryAfterMs: 7000,
    });
    expect(await failure("404")).toMatchObject({ retryable: false, code: "svc_gone" });
    expect(await failure("400")).toMatchObject({ retryable: false, code: "svc_rejected" });
  });

  it("times out slow upstreams as a retryable error", async () => {
    const err = await failure("slow", 200);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ retryable: true, code: "svc_timeout" });
  });

  it("treats connection failures as retryable", async () => {
    const err = await send("svc", "http://127.0.0.1:1/", {}).catch((e) => e);
    expect(err).toMatchObject({ retryable: true, code: "svc_unreachable" });
  });
});

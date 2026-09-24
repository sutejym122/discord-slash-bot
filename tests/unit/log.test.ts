import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/server/log";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOG_LEVEL = "error";
  });

  it("redacts credentials at any depth", () => {
    process.env.LOG_LEVEL = "info";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("delivering", {
      jobId: "j1",
      webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      request: {
        headers: { Authorization: "Bot abc" },
        token: "interaction-token",
      },
    });
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.jobId).toBe("j1");
    expect(JSON.stringify(line)).not.toMatch(/secret|abc|interaction-token/);
  });
});

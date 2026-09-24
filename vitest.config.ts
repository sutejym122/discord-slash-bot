import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/support/env.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

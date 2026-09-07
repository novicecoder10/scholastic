import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    env: {
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See the stub for why: `server-only` is a bundler marker with nothing to
      // resolve to under the node test environment.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});

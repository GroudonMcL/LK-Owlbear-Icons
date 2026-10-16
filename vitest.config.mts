import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts", "extension/test/**/*.test.ts", "deploy/**/*.test.ts"],
    environment: "node",
  },
});

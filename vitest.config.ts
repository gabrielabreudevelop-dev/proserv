import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes de integração usam um banco próprio — nunca o de desenvolvimento.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined) ??
  "postgresql://postgres:postgres@localhost:5432/proserv_test";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // Os testes de integração compartilham o banco: rodam um arquivo por vez.
    fileParallelism: false,
  },
});

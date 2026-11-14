import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // lib/ imports "server-only", which throws outside Next's server bundles.
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    // Playwright owns tests/e2e; Vitest must not pick those files up.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});

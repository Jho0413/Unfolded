import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    // Playwright owns tests/e2e; Vitest must not pick those files up.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});

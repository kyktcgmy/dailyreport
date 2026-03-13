import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json の paths エイリアス（@/*）を Vitest でも解決する
    // vite-tsconfig-paths プラグインの代わりにネイティブオプションを使用
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["app/**/*.ts", "lib/**/*.ts"],
      exclude: ["app/**/*.test.ts", "**/*.d.ts"],
    },
    env: {
      NODE_ENV: "test",
    },
  },
});

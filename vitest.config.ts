import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app uses the automatic JSX runtime (tsconfig.web.json `jsx: "react-jsx"`).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.ts"],
    env: { NO_COLOR: "1" },
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static demo build for covallaby.github.io/demo — same UI, captured fixtures.
export default defineConfig({
  root: "web",
  base: "/demo/",
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("1") },
  plugins: [react(), tailwindcss()],
  build: { outDir: "demo-dist", emptyOutDir: true },
});

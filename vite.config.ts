import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode single` makes one self-contained HTML file for offline use.
export default defineConfig(({ mode }) => ({
  base: mode === "single" ? "./" : process.env.BASE_PATH ?? "./",
  plugins: mode === "single" ? [viteSingleFile()] : [],
  build: { target: "es2022", outDir: mode === "single" ? "dist-single" : "dist", chunkSizeWarningLimit: 1500 },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "jsdom",
  },
}));

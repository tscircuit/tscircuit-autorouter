import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@tscircuit/high-density-a01-a11-a12": fileURLToPath(
        new URL("./vendor/high-density-a11-a12-runtime.mjs", import.meta.url),
      ),
    },
  },
})

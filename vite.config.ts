import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"

const highDensityA11RuntimePath = fileURLToPath(
  new URL("./vendor/high-density-a11-runtime.bundle.mjs", import.meta.url),
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@tscircuit/high-density-a01": highDensityA11RuntimePath,
      "@tscircuit/high-density-a01-a11": highDensityA11RuntimePath,
    },
  },
})

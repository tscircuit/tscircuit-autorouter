import { defineConfig } from "tsup"

export default defineConfig({
  // Git installs expose TypeScript; keep the autorouter's runtime output JavaScript.
  noExternal: ["@tscircuit/pad-junction-simplifier"],
})

import { defineConfig } from "tsup"

export default defineConfig({
  noExternal: ["@tscircuit/trace-simplification-solver"],
})

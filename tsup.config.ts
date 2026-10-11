import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "lib/index.ts",
    pipeline9LocalWorker:
      "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pipeline9LocalWorker.ts",
  },
  minify: "terser",
  external: ["@tscircuit/core", "circuit-to-svg"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
})

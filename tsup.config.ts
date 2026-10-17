import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "lib/index.ts",
    pipeline9HighDensityWorker: "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9HighDensityWorker.ts",
  },
})

import { writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../benchmark/scenarios"

type Measurement = {
  sample: number
  name: string
  repeat: number
  totalMs: number
  pathingIncludingConstructorMs: number
  pathingStageMs: number | null
  solved: boolean
  error: string | null
}
const samples: number[] = process.argv[2]!.split(",").map(Number)
const repeats: number = Number(process.argv[3] ?? 3)
const output: string = process.argv[4]!
if (
  !output ||
  samples.some((sample): boolean => !Number.isInteger(sample) || sample < 1) ||
  !Number.isInteger(repeats) ||
  repeats < 1
) {
  throw new Error(
    "Usage: bun --cpu-prof scripts/astar-recording/profileDataset01Pathing.ts 1,2,3 REPEATS OUTPUT.json",
  )
}
const measurements: Measurement[] = []
for (const sample of samples) {
  const input = await loadScenarioBySampleNumber("dataset01", sample, 1)
  for (let repeat = 0; repeat < repeats; repeat++) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      input.scenario,
      { effort: 1, cacheProvider: null },
    )
    const start = performance.now()
    let pathingStart: number | undefined
    while (
      !solver.failed &&
      !solver.solved &&
      !solver.portPointPathingSolver?.solved
    ) {
      if (
        solver.getCurrentPhase() === "portPointPathingSolver" &&
        pathingStart === undefined
      )
        pathingStart = performance.now()
      solver.step()
    }
    const end = performance.now()
    measurements.push({
      sample,
      name: input.scenarioName,
      repeat,
      totalMs: end - start,
      pathingIncludingConstructorMs:
        pathingStart === undefined ? 0 : end - pathingStart,
      pathingStageMs: solver.timeSpentOnPhase.portPointPathingSolver ?? null,
      solved: solver.portPointPathingSolver?.solved === true,
      error: solver.error,
    })
  }
}
writeFileSync(output, JSON.stringify(measurements, null, 2))
console.log(JSON.stringify(measurements))

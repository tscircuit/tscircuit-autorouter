import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PipelineStageDebugRunner } from "../lib/testing/PipelineStageDebugRunner"
import { phaseOptions } from "../tests/post-routing/fixtures"
import { createComparisonBoard } from "../tests/post-routing/comparison-fixtures"

const [
  arm = "B",
  outputDir = "/tmp/post-routing-stage-captures",
  mode = "png",
] = process.argv.slice(2)
if (!["baseline", "A", "B", "A+B"].includes(arm)) {
  throw new Error(
    "Usage: bun scripts/capture-post-routing-stages.ts baseline|A|B|A+B OUTPUT_DIR",
  )
}
const input = createComparisonBoard()
const options = phaseOptions()
options.objective.maxBendIncrease = 4
const passes = arm === "A+B" ? 2 : 1
options.search.maxExpansions /= passes
options.search.maxMilliseconds /= passes
const tree = structuredClone(options)
tree.nets.forEach((plan) => delete plan.componentPlanning)
const routingOptions = {
  effort: 0.1,
  cacheProvider: null,
  ...(arm.includes("A") ? { dynamicNetTreeRouting: tree } : {}),
  ...(arm.includes("B") ? { postRoutingOptimization: options } : {}),
}
const solver = new Pipeline9(input, routingOptions)
const hasTree = solver.pipelineDef.some(
  (stage) => stage.solverName === "dynamicNetTreeSolver",
)
if (hasTree !== arm.includes("A"))
  throw new Error("Requested arm is unavailable on this branch")
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
if (mode === "graphics") {
  const random = Math.random
  let state = 1
  Math.random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  try {
    solver.solve()
  } finally {
    Math.random = random
  }
  if (!solver.solved)
    throw new Error(solver.error ?? "Pipeline9 capture failed")
  await mkdir(outputDir, { recursive: true })
  const stages = []
  for (const stageName of [
    "dynamicNetTreeSolver",
    "dynamicNetTreeValidationSolver",
    "postRoutingForestSolver",
    "postRoutingOptimizationSolver",
  ]) {
    const stage = (
      solver as unknown as Record<
        string,
        | { getRecordedGraphics(): unknown; stats: unknown; iterations: number }
        | undefined
      >
    )[stageName]
    if (!stage) continue
    const graphicsJsonPath = path.join(outputDir, `${stageName}.graphics.json`)
    await writeFile(
      graphicsJsonPath,
      JSON.stringify(stage.getRecordedGraphics(), null, 2),
    )
    stages.push({
      stageName,
      graphicsJsonPath,
      stats: stage.stats,
      iterations: stage.iterations,
    })
  }
  await writeFile(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(
      {
        sourceHead,
        arm,
        seed: 1,
        input,
        options: routingOptions,
        stages,
        report: solver.getPostRoutingOptimizationResult(),
        output: solver.getOutputSimpleRouteJson(),
      },
      null,
      2,
    ),
  )
  console.log(path.join(outputDir, "manifest.json"))
  process.exit(0)
}
const runner = new PipelineStageDebugRunner({
  pipelineSolver: solver,
  outputDir,
  pngWidth: 1536,
  pngHeight: 1536,
  writeSvg: true,
  writeGraphicsJson: true,
  writeStepPngs: true,
  context: { arm, upstream: "911963b2f539f38140386cb0073332053b2d4582" },
})
const artifacts = await runner.run()
await writeFile(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(
    {
      ...artifacts,
      arm,
      report: solver.getPostRoutingOptimizationResult(),
      output: solver.solved ? solver.getOutputSimpleRouteJson() : null,
    },
    null,
    2,
  ),
)
console.log(path.join(outputDir, "manifest.json"))

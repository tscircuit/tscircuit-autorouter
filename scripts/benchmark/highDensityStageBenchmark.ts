import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseArgs } from "node:util"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import stableStringify from "fast-json-stable-stringify"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { InMemoryCache } from "../../lib/cache/InMemoryCache"
import { LocalStorageCache } from "../../lib/cache/LocalStorageCache"
import { loadScenarioBySampleNumber, parseDatasetName } from "./scenarios"

// Run capture on the baseline revision once, then replay the saved input in a
// fresh process on each revision. This preserves identical upstream routing,
// connectivity, solver options, and initially empty caches across comparisons.
// Example: bun scripts/benchmark/highDensityStageBenchmark.ts --mode capture
//   --dataset srj18 --sample 13 --revision BASE_SHA --output /tmp/input.json
// Example: bun scripts/benchmark/highDensityStageBenchmark.ts --mode replay
//   --input /tmp/input.json --revision HEAD_SHA --output /tmp/result.json

type SerializedStageParams = Omit<
  Pipeline9HighDensitySolverParams,
  "connMap" | "nodePfById"
> & {
  connMap: {
    netMap: Record<string, string[]>
    idToNetMap: Record<string, string>
  }
  nodePfById: Record<string, number | null>
}

type CapturedStage = {
  version: 1
  dataset: string
  sampleNumber: number
  scenarioName: string
  captureRevision: string
  captureTimeMs: number
  upstreamStageTimes: Record<string, number>
  params: SerializedStageParams
}

type StageBenchmarkResult = {
  version: 1
  dataset: string
  sampleNumber: number
  scenarioName: string
  captureRevision: string
  revision: string
  bunVersion: string
  inputHash: string
  outputHash: string
  solved: boolean
  failed: boolean
  timedOut: boolean
  error: string | null
  elapsedTimeMs: number
  peakRssBytes: number
  iterations: number
  routeCount: number
  routePointCount: number
  viaCount: number
  fixedRouteCount: number
  unsolvedNodeCount: number
  failedSolverCount: number
  stats: Record<string, unknown>
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string" },
    dataset: { type: "string", default: "srj18" },
    sample: { type: "string", default: "1" },
    effort: { type: "string", default: "1" },
    input: { type: "string" },
    output: { type: "string" },
    "routes-output": { type: "string" },
    revision: { type: "string", default: "unknown" },
    "timeout-seconds": { type: "string", default: "600" },
  },
  strict: true,
})

const saveJson = async (path: string, value: unknown): Promise<void> => {
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) throw new Error(`Cannot serialize ${path}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${serialized}\n`)
  console.log(`Wrote ${path}`)
}

const capture = async (outputPath: string): Promise<void> => {
  const dataset = parseDatasetName(values.dataset!)
  const sample = Number(values.sample)
  const effort = Number(values.effort)
  const timeoutMs = Number(values["timeout-seconds"]) * 1_000
  if (!dataset || !Number.isInteger(sample) || sample < 1 || effort <= 0) {
    throw new Error("Capture requires a valid dataset, sample, and effort")
  }
  const { scenarioName, scenario } = await loadScenarioBySampleNumber(
    dataset,
    sample,
    effort,
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort },
  )
  const startedAt = performance.now()
  let previousPhase = ""
  while (pipeline.getCurrentPhase() !== "highDensityRouteSolver") {
    if (pipeline.solved || pipeline.failed) {
      throw new Error(
        `Capture failed at ${pipeline.getCurrentPhase()}: ${pipeline.error}`,
      )
    }
    if (pipeline.getCurrentPhase() !== previousPhase) {
      previousPhase = pipeline.getCurrentPhase()
      console.log(
        JSON.stringify({
          sample,
          phase: previousPhase,
          elapsedTimeMs: performance.now() - startedAt,
        }),
      )
    }
    pipeline.step()
    if (
      (pipeline.iterations & 1023) === 0 &&
      performance.now() - startedAt > timeoutMs
    ) {
      throw new Error(`Capture timed out at ${pipeline.getCurrentPhase()}`)
    }
  }
  const stage = pipeline.pipelineDef[pipeline.currentPipelineStepIndex]!
  const [params] = stage.getConstructorParams(pipeline) as [
    Pipeline9HighDensitySolverParams,
  ]
  const nodePfById =
    params.nodePfById instanceof Map
      ? Object.fromEntries(params.nodePfById)
      : params.nodePfById
  if (!nodePfById) throw new Error("Pipeline9 stage is missing nodePfById")
  if (
    Object.values(nodePfById).some(
      (value) => value !== null && !Number.isFinite(value),
    )
  ) {
    throw new Error("Pipeline9 stage has a non-finite node probability")
  }
  const captured: CapturedStage = {
    version: 1,
    dataset,
    sampleNumber: sample,
    scenarioName,
    captureRevision: values.revision!,
    captureTimeMs: performance.now() - startedAt,
    upstreamStageTimes: pipeline.timeSpentOnPhase,
    params: {
      ...params,
      nodePfById,
      connMap: {
        netMap: params.connMap.netMap,
        idToNetMap: params.connMap.idToNetMap,
      },
    },
  }
  await saveJson(outputPath, captured)
  console.log(
    JSON.stringify({
      sample,
      nodeCount: params.nodePortPoints.length,
      captureTimeMs: captured.captureTimeMs,
    }),
  )
}

const replay = async (outputPath: string): Promise<void> => {
  if (!values.input) throw new Error("Replay requires --input")
  const inputText = await readFile(values.input, "utf8")
  const captured = JSON.parse(inputText) as CapturedStage
  if (captured.version !== 1) throw new Error("Unsupported capture version")
  const inputHash = createHash("sha256")
    .update(stableStringify(captured.params))
    .digest("hex")
  const timeoutMs = Number(values["timeout-seconds"]) * 1_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid timeout")
  const connMap = new ConnectivityMap(captured.params.connMap.netMap)
  connMap.idToNetMap = captured.params.connMap.idToNetMap
  // Every invocation is a fresh process; explicitly reset the autorouter caches
  // too, so standalone replays never inherit work from upstream pipeline stages.
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE = new LocalStorageCache()
  const startedAt = performance.now()
  const solver = new Pipeline9HighDensitySolver({ ...captured.params, connMap })
  let timedOut = false
  let thrownError: string | null = null
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      if (
        (solver.iterations & 1023) === 0 &&
        performance.now() - startedAt > timeoutMs
      ) {
        timedOut = true
        break
      }
    }
  } catch (error) {
    thrownError = error instanceof Error ? error.message : String(error)
  }
  const elapsedTimeMs = performance.now() - startedAt
  // The Node-compatible resourceUsage API reports peak process RSS in KiB.
  // Read it after timing, before output hashing/serialization adds memory use.
  const peakRssBytes = process.resourceUsage().maxRSS * 1024
  const output = {
    routes: solver.routes,
    fixedRoutes: solver.getUpdatedFixedHdRoutes(),
    removedFixedRouteConnectionNames: [
      ...solver.removedFixedRouteConnectionNames,
    ],
    preloadedTraceMutationMasks: [...solver.preloadedTraceMutationMasks],
  }
  const result: StageBenchmarkResult = {
    version: 1,
    dataset: captured.dataset,
    sampleNumber: captured.sampleNumber,
    scenarioName: captured.scenarioName,
    captureRevision: captured.captureRevision,
    revision: values.revision!,
    bunVersion: Bun.version,
    inputHash,
    outputHash: createHash("sha256")
      .update(stableStringify(output))
      .digest("hex"),
    solved: solver.solved,
    failed: solver.failed,
    timedOut,
    error: thrownError ?? solver.error,
    elapsedTimeMs,
    peakRssBytes,
    iterations: solver.iterations,
    routeCount: solver.routes.length,
    routePointCount: solver.routes.reduce(
      (sum, route) => sum + route.route.length,
      0,
    ),
    viaCount: solver.routes.reduce((sum, route) => sum + route.vias.length, 0),
    fixedRouteCount: output.fixedRoutes.length,
    unsolvedNodeCount: solver.unsolvedNodePortPoints.length,
    failedSolverCount: solver.failedSolvers.length,
    stats: solver.stats,
  }
  await saveJson(outputPath, result)
  if (values["routes-output"]) await saveJson(values["routes-output"], output)
  console.log(JSON.stringify(result))
  if (thrownError) process.exitCode = 1
}

if (!values.output)
  throw new Error("Use --output PATH and --mode capture|replay")
if (values.mode === "capture") await capture(values.output)
else if (values.mode === "replay") await replay(values.output)
else throw new Error("Use --mode capture|replay")

import { createHash } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { dataset } from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../../lib/types"
import { solverProfile } from "./solverProfile"

type NodeId = string
type NodeTiming = {
  nodeId: NodeId
  durationMs: number
  steps: number
  status: string
  winningSolver: string | null
  resizeCount: number | null
}

export type StageTiming = {
  stage: string
  durationMs: number
  steps: number
  status: string
  internalDurationMs: number | null
}

export async function runSample(options: {
  sample: number
  effort: number
  outFile: string
  detailed: boolean
}): Promise<void> {
  const sampleId = `sample${String(options.sample).padStart(3, "0")}`
  const entry = Object.entries(dataset).find(([key]) => key === sampleId)
  if (!entry) throw new Error(`Unknown SRJ18 sample: ${sampleId}`)
  const inputSrj = structuredClone(entry[1]) as SimpleRouteJson
  const inputSha256 = createHash("sha256")
    .update(JSON.stringify(inputSrj))
    .digest("hex")
  solverProfile.enabled = options.detailed
  const cpuStart = process.cpuUsage()
  const startMs = performance.now()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: options.effort,
  })
  const constructionDurationMs = performance.now() - startMs
  const stages: StageTiming[] = solver.pipelineDef.map(({ solverName }) => ({
    stage: solverName,
    durationMs: 0,
    steps: 0,
    status: "not_reached",
    internalDurationMs: null,
  }))
  const nodeTimings = new Map<NodeId, NodeTiming>()
  let thrownError: string | null = null
  let lastLogMs = performance.now()
  try {
    while (!solver.solved && !solver.failed) {
      const stage = stages[solver.currentPipelineStepIndex]
      solverProfile.stage = stage?.stage ?? "pipeline_completion"
      const hdSolver =
        stage?.stage === "highDensityRouteSolver"
          ? solver.highDensityRouteSolver
          : null
      const node =
        hdSolver?.activeNode ?? hdSolver?.unsolvedNodePortPoints.at(-1)
      const regularSolver = hdSolver?.activeRegularSolver
      const stepStartMs = performance.now()
      try {
        solver.step()
      } finally {
        const stepDurationMs = performance.now() - stepStartMs
        if (stage) {
          stage.durationMs += stepDurationMs
          stage.steps++
          stage.status = solver.failed
            ? "failed"
            : solver.getCurrentPhase() !== stage.stage
              ? "solved"
              : "running"
        }
        if (node) {
          let timing = nodeTimings.get(node.capacityMeshNodeId)
          if (!timing) {
            timing = {
              nodeId: node.capacityMeshNodeId,
              durationMs: 0,
              steps: 0,
              status: "running",
              winningSolver: null,
              resizeCount: null,
            }
            nodeTimings.set(node.capacityMeshNodeId, timing)
          }
          timing.durationMs += stepDurationMs
          timing.steps++
          if (!hdSolver?.activeNode) {
            timing.status = solver.failed ? "failed" : "solved"
            timing.winningSolver =
              regularSolver?.nodeSolveMetadataById.get(node.capacityMeshNodeId)
                ?.solverType ?? null
            timing.resizeCount =
              typeof regularSolver?.stats.highDensityResizeCount === "number"
                ? regularSolver.stats.highDensityResizeCount
                : null
          }
        }
      }
      if (performance.now() - lastLogMs > 15000) {
        console.log(
          `${sampleId} stage=${solver.getCurrentPhase()} duration=${((performance.now() - startMs) / 1000).toFixed(3)}s`,
        )
        lastLogMs = performance.now()
      }
    }
  } catch (error) {
    thrownError = String(error)
  }
  const durationMs = performance.now() - startMs
  const cpuUsage = process.cpuUsage(cpuStart)
  solverProfile.enabled = false
  for (const stage of stages) {
    stage.internalDurationMs = solver.timeSpentOnPhase[stage.stage] ?? null
  }
  const outputStartMs = performance.now()
  const outputSrj = solver.solved ? solver.getOutputSimpleRouteJson() : null
  const outputDurationMs = performance.now() - outputStartMs
  const validationStartMs = performance.now()
  const drc = solver.solved
    ? evaluateRelaxedDrc({
        inputSrj,
        srjWithPointPairs: solver.srjWithPointPairs ?? inputSrj,
        routedTraces: solver.getOutputSimplifiedPcbTraces(),
      })
    : null
  const validationDurationMs = performance.now() - validationStartMs
  const profile = options.detailed ? solverProfile.export() : null
  const report = {
    schemaVersion: 2,
    sampleId,
    effort: options.effort,
    detailed: options.detailed,
    inputSha256,
    inputConnections: inputSrj.connections.length,
    inputObstacles: inputSrj.obstacles.length,
    layerCount: inputSrj.layerCount,
    solved: solver.solved,
    failed: solver.failed,
    error: thrownError ?? solver.error,
    durationMs,
    constructionDurationMs,
    outputDurationMs,
    validationDurationMs,
    cpuUserMs: cpuUsage.user / 1000,
    cpuSystemMs: cpuUsage.system / 1000,
    peakRssBytes:
      process.resourceUsage().maxRSS *
      (process.platform === "darwin" ? 1 : 1024),
    iterations: solver.iterations,
    stages,
    nodeTimings: [...nodeTimings.values()],
    outputSha256: outputSrj
      ? createHash("sha256").update(JSON.stringify(outputSrj)).digest("hex")
      : null,
    outputTraceCount: outputSrj?.traces?.length ?? null,
    relaxedDrcErrors: drc?.errors ?? null,
    highDensityStats: solver.highDensityRouteSolver?.stats ?? null,
    highDensityNodes:
      solver.highDensityNodePortPoints?.map((node) => ({
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPointCount: node.portPoints.length,
        connectionCount: new Set(
          node.portPoints.map((point) => point.connectionName),
        ).size,
        nodePf:
          solver.highDensityRouteSolver?.nodePfById.get(
            node.capacityMeshNodeId,
          ) ?? null,
      })) ?? [],
    profile,
  }
  await mkdir(dirname(options.outFile), { recursive: true })
  const outputPath = options.detailed
    ? `${options.outFile}.gz`
    : options.outFile
  const serialized = options.detailed
    ? Bun.gzipSync(JSON.stringify(report))
    : JSON.stringify(report, null, 2)
  await writeFile(`${outputPath}.tmp`, serialized)
  await rename(`${outputPath}.tmp`, outputPath)
  console.log(
    `${sampleId} ${solver.solved ? "solved" : "failed"} duration=${(durationMs / 1000).toFixed(3)}s drc=${drc?.errors.length ?? "not_run"} wrote=${outputPath}`,
  )
  if (thrownError) process.exitCode = 1
}

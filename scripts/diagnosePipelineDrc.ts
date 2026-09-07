import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimplifiedPcbTrace } from "lib/types/srj-types"
import {
  loadScenarioBySampleNumber,
  parseDatasetName,
} from "./benchmark/scenarios"

type Pipeline =
  | AutoroutingPipelineSolver7_MultiGraph
  | AutoroutingPipelineSolver9_PreloadedTraceGraph

type StageSummary = {
  phase: string
  scope: "input" | "node-copper-projection" | "materialized-board"
  errorCount: number
  errorTypes: Record<string, number>
  traceCount: number
}

type NodeObservation = {
  nodeId: string
  node: NodeWithPortPoints
  solver: string
  scaleFactor: number | null
  growthAttempts: number | null
  metadata: unknown
  routes: HighDensityRoute[]
}

const NODE_PHASES = new Set([
  "highDensityRouteSolver",
  "highDensityForceImproveSolver",
  "highDensityRepairSolver",
])

const BOARD_PHASES = new Set([
  "highDensityStitchSolver",
  "traceSimplificationSolver",
  "mutatedPreloadedTraceSimplificationSolver",
  "traceWidthSolver",
  "globalDrcForceImproveSolver",
  "exactGeometryDrcForceImproveSolver",
  "pipeline9JointDrcRepairSolver",
])

const getStageRoutes = (
  pipeline: Pipeline,
  phase: string,
): HighDensityRoute[] => {
  switch (phase) {
    case "highDensityRouteSolver":
      return pipeline.highDensityRouteSolver!.routes
    case "highDensityForceImproveSolver":
      return pipeline.highDensityForceImproveSolver!.getOutput()
    case "highDensityRepairSolver":
      return pipeline.highDensityRepairSolver!.getOutput()
    case "highDensityStitchSolver":
      return pipeline.highDensityStitchSolver!.mergedHdRoutes
    case "traceSimplificationSolver":
    case "mutatedPreloadedTraceSimplificationSolver":
      return pipeline.traceSimplificationSolver!.simplifiedHdRoutes
    case "traceWidthSolver":
      return pipeline.traceWidthSolver!.getHdRoutesWithWidths()
    case "globalDrcForceImproveSolver":
      return pipeline.globalDrcForceImproveSolver!.getOutput()
    case "exactGeometryDrcForceImproveSolver":
      if (pipeline instanceof AutoroutingPipelineSolver7_MultiGraph) {
        return pipeline.exactGeometryDrcForceImproveSolver!.getOutput()
      }
      throw new Error("Exact-geometry stage requires Pipeline7")
    case "pipeline9JointDrcRepairSolver":
      if (pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph) {
        return pipeline.pipeline9JointDrcRepairSolver!.getOutput()
      }
      throw new Error("Joint stage requires Pipeline9")
    default:
      throw new Error(`Unsupported diagnostic route stage: ${phase}`)
  }
}

const convertStageRoutes = (
  pipeline: Pipeline,
  phase: string,
  routes: HighDensityRoute[],
): SimplifiedPcbTrace[] => {
  const pointPairSolver = pipeline.netToPointPairsSolver
  if (!pointPairSolver) {
    throw new Error(`Missing point-pair metadata for ${phase}`)
  }
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: pointPairSolver.newConnections,
    originalConnections: pipeline.originalSrj.connections,
    hdRoutes: routes,
    layerCount: pipeline.srj.layerCount,
    obstacles: pipeline.srj.obstacles,
    defaultViaHoleDiameter: pipeline.viaHoleDiameter,
    connMap: pipeline.connMap,
  })
  const uniqueTraces = assignUniquePcbTraceIdsToNewTraces(
    traces,
    pipeline.originalSrj.traces ?? [],
  )
  if (
    BOARD_PHASES.has(phase) &&
    pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
  ) {
    return [...pipeline.getMutatedPreloadedTraces(), ...uniqueTraces]
  }
  return uniqueTraces
}

const writeStage = async (
  pipeline: Pipeline,
  outputDir: string,
  phase: string,
  routedTraces: SimplifiedPcbTrace[],
  routes: HighDensityRoute[],
  scope: StageSummary["scope"],
): Promise<StageSummary> => {
  const result = evaluateRelaxedDrc({
    inputSrj: pipeline.originalSrj,
    srjWithPointPairs: pipeline.srjWithPointPairs ?? pipeline.originalSrj,
    routedTraces,
    drcOptions:
      scope === "node-copper-projection"
        ? { includeTraceContinuity: false }
        : undefined,
  })
  const evaluatedTraces = combinePreloadedAndRoutedTraces(
    pipeline.originalSrj.traces ?? [],
    routedTraces,
  )
  const errorTypes: Record<string, number> = {}
  for (const error of result.errors) {
    errorTypes[error.type] = (errorTypes[error.type] ?? 0) + 1
  }
  const summary: StageSummary = {
    phase,
    scope,
    errorCount: result.errors.length,
    errorTypes,
    traceCount: evaluatedTraces.length,
  }
  const routedTraceObjects = new Set(routedTraces)
  const traceOwnership = evaluatedTraces.map((trace) => ({
    pcbTraceId: trace.pcb_trace_id,
    connectionName: trace.connection_name,
    ownership: trace.__replaces_pcb_trace_id
      ? "mutated-preloaded"
      : routedTraceObjects.has(trace)
        ? "new"
        : "preloaded",
    replacesPcbTraceId: trace.__replaces_pcb_trace_id,
  }))
  await writeFile(
    path.join(outputDir, `${phase}.json`),
    JSON.stringify({
      ...summary,
      // Before stitching these are node fragments, not a final-board score.
      // Keep original and routed geometry to diagnose seam/ownership effects.
      // Changed preload fragments absent from newConnections remain in hdRoutes
      // but are not materialized in this pre-stitch copper projection.
      errors: result.errorsWithCenters,
      traceOwnership,
      routedTraces,
      hdRoutes: routes,
      circuitJson: result.circuitJson,
    }),
  )
  console.log(JSON.stringify(summary))
  return summary
}

const diagnosePipelineDrc = async (): Promise<void> => {
  const [datasetArg, sampleArg, pipelineArg, outputDir] = process.argv.slice(2)
  const dataset = parseDatasetName(datasetArg)
  const sample = Number(sampleArg)
  if (
    !dataset ||
    !Number.isInteger(sample) ||
    sample < 1 ||
    (pipelineArg !== "7" && pipelineArg !== "9") ||
    !outputDir
  ) {
    throw new Error(
      "Usage: bun scripts/diagnosePipelineDrc.ts DATASET SAMPLE 7|9 OUTPUT_DIR",
    )
  }
  await mkdir(outputDir, { recursive: true })
  const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
  const pipeline: Pipeline =
    pipelineArg === "9"
      ? new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario)
      : new AutoroutingPipelineSolver7_MultiGraph(scenario)
  await writeFile(path.join(outputDir, "input.json"), JSON.stringify(scenario))
  const summaries: StageSummary[] = [
    await writeStage(pipeline, outputDir, "input", [], [], "input"),
  ]
  const nodes: NodeObservation[] = []
  const growthByNode = new Map<string, GrowShrinkHighDensityIntraNodeSolver>()
  while (!pipeline.solved && !pipeline.failed) {
    const phase = pipeline.getCurrentPhase()
    const hd =
      pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
        ? pipeline.highDensityRouteSolver
        : undefined
    const node = hd?.activeNode
    const regular = hd?.activeRegularSolver
    const nodeSolver = regular ?? hd?.activeB01Solver ?? hd?.activeFallbackSolver
    const grow = regular?.activeSubSolver
    if (node && grow instanceof GrowShrinkHighDensityIntraNodeSolver) {
      growthByNode.set(node.capacityMeshNodeId, grow)
    }
    const routeStart = hd?.routes.length ?? 0
    pipeline.step()
    if (hd && node && nodeSolver && hd.activeNode !== node) {
      const completedGrowth = regular
        ? growthByNode.get(node.capacityMeshNodeId)
        : undefined
      nodes.push({
        nodeId: node.capacityMeshNodeId,
        node,
        solver: nodeSolver.getSolverName(),
        scaleFactor: completedGrowth ? completedGrowth.scaleFactor : null,
        growthAttempts: completedGrowth ? completedGrowth.growthAttempts : null,
        metadata: regular ? [...regular.nodeSolveMetadataById.values()] : null,
        routes: hd.routes.slice(routeStart),
      })
    }
    if (pipeline.getCurrentPhase() !== phase) {
      if (NODE_PHASES.has(phase) || BOARD_PHASES.has(phase)) {
        const routes = getStageRoutes(pipeline, phase)
        summaries.push(
          await writeStage(
            pipeline,
            outputDir,
            phase,
            convertStageRoutes(pipeline, phase, routes),
            routes,
            NODE_PHASES.has(phase)
              ? "node-copper-projection"
              : "materialized-board",
          ),
        )
      }
      await writeFile(
        path.join(outputDir, "progress.json"),
        JSON.stringify({
          phase: pipeline.getCurrentPhase(),
          solved: pipeline.solved,
          failed: pipeline.failed,
          error: pipeline.error,
          summaries,
        }),
      )
      if (phase === "highDensityRouteSolver") {
        await writeFile(
          path.join(outputDir, "nodes.json"),
          JSON.stringify(nodes),
        )
      }
    }
  }
  if (!pipeline.solved) {
    await writeFile(
      path.join(outputDir, "progress.json"),
      JSON.stringify({
        phase: pipeline.getCurrentPhase(),
        solved: pipeline.solved,
        failed: pipeline.failed,
        error: pipeline.error,
        summaries,
      }),
    )
    await writeFile(path.join(outputDir, "nodes.json"), JSON.stringify(nodes))
    throw new Error(`Diagnostic solve failed: ${pipeline.error}`)
  }
  summaries.push(
    await writeStage(
      pipeline,
      outputDir,
      "final",
      pipeline.getOutputSimplifiedPcbTraces(),
      [],
      "materialized-board",
    ),
  )
  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify({ dataset, sample, pipeline: pipelineArg, summaries }),
  )
}

await diagnosePipelineDrc()

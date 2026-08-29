import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  normalizePipeline9NodeRootConnectionNames,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createRegionalFallbackProblem } from "../AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { Pipeline9RegionalFallbackSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type {
  Pipeline9NetworkedHighDensityNodeInput,
  Pipeline9NetworkedHighDensityNodeOutput,
} from "./pipeline9NetworkedTypes"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "./pipeline9NetworkedTypes"

type Pipeline9OrdinaryNodeResult =
  | {
      status: "solved"
      routes: Extract<
        Pipeline9NetworkedHighDensityNodeOutput,
        { status: "solved" }
      >["routes"]
    }
  | {
      status: "failed"
      error: string
    }

const solvePipeline9OrdinaryHighDensityNode = ({
  input,
  connMap,
}: {
  input: Pipeline9NetworkedHighDensityNodeInput
  connMap: ConnectivityMap
}): Pipeline9OrdinaryNodeResult => {
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: input.nodeWithPortPoints,
    colorMap: input.colorMap,
    connMap,
    viaDiameter: input.viaDiameter,
    traceWidth: input.traceWidth,
    obstacleMargin: input.obstacleMargin,
    effort: input.effort,
    nodePfById: {
      [input.nodeWithPortPoints.capacityMeshNodeId]: input.nodePf,
    },
    obstacles: input.obstacles,
    layerCount: input.layerCount,
  })
  solver.solve()
  return solver.solved
    ? { status: "solved", routes: solver.routes }
    : {
        status: "failed",
        error: solver.error || "Pipeline9 ordinary high-density solver failed",
      }
}

/**
 * Runs Pipeline9's terminal no-fixed-copper node policy. hd-cache2 calls this
 * exported helper so ordinary and regional cache entries can only be produced
 * by its installed autorouter implementation.
 */
export function solvePipeline9NetworkedHighDensityNode(
  input: Pipeline9NetworkedHighDensityNodeInput,
): Pipeline9NetworkedHighDensityNodeOutput {
  if (input.solvePolicy !== PIPELINE9_NETWORKED_SOLVE_POLICY) {
    throw new Error(
      `Unsupported Pipeline9 networked solve policy ${String(input.solvePolicy)}`,
    )
  }
  if (input.effort !== 1) {
    throw new Error(
      `Pipeline9 networked high-density solving requires effort=1, received ${input.effort}`,
    )
  }

  const connMap = new ConnectivityMap(input.connectivityNetMap)
  const ordinaryResult = solvePipeline9OrdinaryHighDensityNode({
    input,
    connMap,
  })
  if (ordinaryResult.status === "solved") {
    return {
      status: "solved",
      solutionStage: "ordinary",
      routes: ordinaryResult.routes,
    }
  }

  const ordinaryFailure = ordinaryResult.error
  if (!input.enableRegionalFallback) {
    return {
      status: "failed",
      solutionStage: "ordinary",
      error: `Pipeline9 regular high-density routing failed: ${ordinaryFailure}`,
    }
  }

  const normalizedNode = normalizePipeline9NodeRootConnectionNames(
    input.nodeWithPortPoints,
    connMap,
  )
  const regionalProblem = createRegionalFallbackProblem(
    {
      ...normalizedNode,
      availableZ: Array.from({ length: input.layerCount }, (_, z) => z),
    },
    [],
  )
  const regionalSolver = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: regionalProblem.nodeWithPortPoints,
    colorMap: input.colorMap,
    connMap,
    viaDiameter: input.viaDiameter,
    traceWidth: input.traceWidth,
    obstacleMargin: input.obstacleMargin,
    effort: input.effort,
    nodePfById: {
      [input.nodeWithPortPoints.capacityMeshNodeId]: input.nodePf,
    },
    obstacles: input.regionalObstacles,
    layerCount: input.layerCount,
  })
  regionalSolver.solve()
  if (regionalSolver.solved) {
    return {
      status: "solved",
      solutionStage: "regional-fallback",
      ordinaryFailure,
      routes: regionalSolver.getOutput(),
    }
  }

  const regionalFailure =
    regionalSolver.error || "Pipeline9 regional fallback solver failed"
  return {
    status: "failed",
    solutionStage: "regional-fallback",
    ordinaryFailure,
    error: [
      `Pipeline9 primary high-density routing failed: regular high-density routing failed: ${ordinaryFailure}`,
      `regional fallback failed: ${regionalFailure}`,
    ].join("; "),
  }
}

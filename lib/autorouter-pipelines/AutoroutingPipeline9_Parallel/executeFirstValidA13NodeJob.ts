import { GrowShrinkHighDensityIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { Pipeline9HighDensitySolver, createPipeline9RegularNodeSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { CompletedFirstValidA13Solver } from "./CompletedFirstValidA13Solver"
import { executeFirstValidA13CandidateJob } from "./executeFirstValidA13CandidateJob"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import { validateFirstValidHighDensityRoutes } from "./validateFirstValidHighDensityRoutes"
import type { FirstValidA13NodeJob, FirstValidA13NodeResult, FirstValidA13NodeWork } from "./parallelHighDensityFrontierTypes"

/** A whole physical-node candidate owns its original A13 budget and metadata repair. */
export function executeFirstValidA13NodeJob(job: FirstValidA13NodeJob): FirstValidA13NodeResult {
  const started = performance.now()
  const cancellation = new Int32Array(job.cancellationBuffer)
  const emptyWork: FirstValidA13NodeWork = { iterations: 0, maxIterations: 0, routingIterations: 0, sourceStats: {} }
  let work = emptyWork
  try {
  if (Atomics.load(cancellation, 0) !== 0) return { kind: job.kind, status: "cancelled", work: emptyWork }
  const context = job.context
  const connMap = restoreWorkerConnectivityMap(context)
  const regular = createPipeline9RegularNodeSolver({ nodeWithPortPoints: job.nodeWithPortPoints,
    connMap, colorMap: context.colorMap, viaDiameter: context.viaDiameter, traceWidth: context.traceWidth,
    obstacleMargin: context.obstacleMargin, effort: context.effort,
    nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf }, obstacles: context.obstacles,
    boardGeometry: context.boardGeometry, layerCount: context.layerCount })
  // The first step only constructs the original physical-scale GrowShrink child.
  regular.step()
  const growShrink = regular.activeSubSolver
  if (!(growShrink instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error("First-valid node factory did not construct its original GrowShrink child")
  }
  const { connMap: _connMap, ...params } = growShrink.constructorParams
  const result = executeFirstValidA13CandidateJob({ kind: "firstValidA13Candidate", params,
    connectivityNetMap: context.connectivityNetMap, connectivityIdToNetMap: context.connectivityIdToNetMap,
    cancellationBuffer: job.cancellationBuffer })
  work = { iterations: result.iterations, maxIterations: result.maxIterations,
    routingIterations: result.routingIterations, sourceStats: result.sourceStats }
  if (result.status === "cancelled") return { kind: job.kind, status: "cancelled", work }
  if (result.status === "failed") return { kind: job.kind, status: "failed", error: result.error, work }
  if (result.status === "exception") return { kind: job.kind, status: "exception", exception: result.exception, work }
  if (Atomics.load(cancellation, 0) !== 0) return { kind: job.kind, status: "cancelled", work }
  const completed = new CompletedFirstValidA13Solver(growShrink.nodeWithPortPoints, result)
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...params, connMap })
  const routeSolver = completed as unknown as IntraNodeRouteSolver
  portfolio.onSolve({ solver: routeSolver, hyperParameters: completed.hyperParameters, g: 0, h: 0, f: 0 })
  if (Atomics.load(cancellation, 0) !== 0) return { kind: job.kind, status: "cancelled", work }
  const validation = validateFirstValidHighDensityRoutes({ routes: portfolio.solvedRoutes,
    node: growShrink.nodeWithPortPoints, connMap, traceWidth: context.traceWidth, viaDiameter: context.viaDiameter,
    obstacleMargin: context.firstValidClearance ?? 0.1, layerCount: context.layerCount,
    obstacles: context.obstacles, boardGeometry: context.boardGeometry })
  if (!validation.valid) return { kind: job.kind, status: "rejected", reason: validation.reason, work }
  const parent = new Pipeline9HighDensitySolver({ ...context, connMap,
    nodePortPoints: [job.nodeWithPortPoints], fixedHdRoutes: [],
    nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf } })
  const nodeStats = { ...parent.stats, regularNodeCount: 1, solvedNodeCount: 1 } as Record<string, number>
  const firstValidStats = { eligiblePortfolioCount: 1, acceptedCandidateCount: 1,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [{
      nodeId: job.nodeWithPortPoints.capacityMeshNodeId, candidateId: -1, candidateIterations: result.iterations,
      elapsedTimeMs: performance.now() - started, candidateSource: "a13" as const,
      routingIterations: result.routingIterations, sourceStats: result.sourceStats,
    }], candidateWork: [{ nodeId: job.nodeWithPortPoints.capacityMeshNodeId, candidateSource: "a13" as const,
      status: result.status, iterations: result.iterations, routingIterations: result.routingIterations,
      sourceStats: result.sourceStats }] }
  return { kind: job.kind, status: "solved", routes: portfolio.solvedRoutes, nodeStats, firstValidStats, work }
  } catch (error: unknown) {
    return { kind: job.kind, status: "exception", work, exception: error instanceof Error
      ? { name: error.name, message: error.message } : { name: "Error", message: String(error) } }
  }
}

import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  type ConvertPipeline7HdRoutesOptions,
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

const AUTOROUTING_TRACE_CLEARANCE = 0.1
const AUTOROUTING_VIA_CLEARANCE = 0.1

/**
 * Scores Pipeline7 repair candidates with reusable autorouting-only DRC state.
 *
 * The checks-based relaxed evaluator remains the reference implementation used
 * by tests and benchmarks; it is intentionally not used in this hot path.
 */
export const createPipeline7AutoroutingDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: SimpleRouteJson
    originalSrj: SimpleRouteJson
  },
): DrcEvaluator => {
  const getObstacleGeometryKey = (
    obstacle: SimpleRouteJson["obstacles"][number],
  ) =>
    [
      obstacle.center.x,
      obstacle.center.y,
      obstacle.width,
      obstacle.height,
    ].join(":")
  const originalObstaclesByGeometry = new Map<
    string,
    SimpleRouteJson["obstacles"]
  >()
  for (const obstacle of conversionOptions.originalSrj.obstacles) {
    const key = getObstacleGeometryKey(obstacle)
    const matchingObstacles = originalObstaclesByGeometry.get(key) ?? []
    matchingObstacles.push(obstacle)
    originalObstaclesByGeometry.set(key, matchingObstacles)
  }
  const engineSrj = {
    ...conversionOptions.srjWithPointPairs,
    // Point-pair preprocessing rewrites layer availability but historically
    // discarded physical shape metadata such as plated-hole pad rotation.
    // Reattach the original geometry fields while retaining the processed
    // layers/connectivity used by Pipeline7.
    obstacles: conversionOptions.srjWithPointPairs.obstacles.map((obstacle) => {
      const originalCandidates =
        originalObstaclesByGeometry.get(getObstacleGeometryKey(obstacle)) ?? []
      const originalObstacle =
        originalCandidates.find((candidate) =>
          candidate.connectedTo.some((id) => obstacle.connectedTo.includes(id)),
        ) ?? originalCandidates[0]
      return originalObstacle ? { ...originalObstacle, ...obstacle } : obstacle
    }),
    minTraceWidth: conversionOptions.originalSrj.minTraceWidth,
    minViaDiameter:
      conversionOptions.originalSrj.minViaDiameter ??
      conversionOptions.srjWithPointPairs.minViaDiameter,
  }
  // DRC interactions cannot span farther than the widest copper feature plus
  // clearance. Indexing at that physical scale avoids board-size-dependent
  // cells that become increasingly coarse on large layouts.
  const spatialCellSize =
    Math.max(
      getViaDimensions(conversionOptions.originalSrj).padDiameter,
      engineSrj.minTraceWidth,
    ) + Math.max(AUTOROUTING_TRACE_CLEARANCE, AUTOROUTING_VIA_CLEARANCE)
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    traceClearance: AUTOROUTING_TRACE_CLEARANCE,
    viaClearance: AUTOROUTING_VIA_CLEARANCE,
    spatialCellSize,
  })
  const convertCandidateRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter(conversionOptions)
  const originalTraces = conversionOptions.originalSrj.traces ?? []

  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 autorouting DRC evaluation requires HD routes")
    }

    const candidateTraces = convertCandidateRoutes(evaluatedRoutes)
    const tracesToEvaluate = (
      originalTraces.length
        ? [...originalTraces, ...candidateTraces]
        : candidateTraces
    ) as RepairSimplifiedPcbTraces

    return engine.evaluate(tracesToEvaluate)
  }
}

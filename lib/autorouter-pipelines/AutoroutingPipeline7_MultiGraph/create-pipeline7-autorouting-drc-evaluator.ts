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
  const getPhysicalObstacleIdentityKey = (
    obstacle: SimpleRouteJson["obstacles"][number],
  ) => {
    const metadata = obstacle.circuitJsonMetadata
    if (metadata?.pcb_smtpad_id) return `pcb_smtpad:${metadata.pcb_smtpad_id}`
    if (metadata?.pcb_plated_hole_id) {
      return `pcb_plated_hole:${metadata.pcb_plated_hole_id}`
    }
    if (metadata?.pcb_via_id) return `pcb_via:${metadata.pcb_via_id}`
    return undefined
  }
  const originalObstaclesByGeometry = new Map<
    string,
    SimpleRouteJson["obstacles"]
  >()
  const originalObstaclesByPhysicalIdentity = new Map<
    string,
    SimpleRouteJson["obstacles"]
  >()
  for (const obstacle of conversionOptions.originalSrj.obstacles) {
    const key = getObstacleGeometryKey(obstacle)
    const matchingObstacles = originalObstaclesByGeometry.get(key) ?? []
    matchingObstacles.push(obstacle)
    originalObstaclesByGeometry.set(key, matchingObstacles)

    const identityKey = getPhysicalObstacleIdentityKey(obstacle)
    if (identityKey) {
      const matchingPhysicalObstacles =
        originalObstaclesByPhysicalIdentity.get(identityKey) ?? []
      matchingPhysicalObstacles.push(obstacle)
      originalObstaclesByPhysicalIdentity.set(
        identityKey,
        matchingPhysicalObstacles,
      )
    }
  }
  const processedObstaclesByPhysicalIdentity = new Map<
    string,
    SimpleRouteJson["obstacles"]
  >()
  for (const obstacle of conversionOptions.srjWithPointPairs.obstacles) {
    const identityKey = getPhysicalObstacleIdentityKey(obstacle)
    if (!identityKey) continue
    const matchingProcessedObstacles =
      processedObstaclesByPhysicalIdentity.get(identityKey) ?? []
    matchingProcessedObstacles.push(obstacle)
    processedObstaclesByPhysicalIdentity.set(
      identityKey,
      matchingProcessedObstacles,
    )
  }
  const restoredPhysicalObstacleIdentities = new Set<string>()
  const engineObstacles: SimpleRouteJson["obstacles"] = []
  for (const obstacle of conversionOptions.srjWithPointPairs.obstacles) {
    const identityKey = getPhysicalObstacleIdentityKey(obstacle)
    const originalPhysicalObstacles = identityKey
      ? originalObstaclesByPhysicalIdentity.get(identityKey)
      : undefined
    if (identityKey && originalPhysicalObstacles?.length) {
      if (restoredPhysicalObstacleIdentities.has(identityKey)) continue

      const originalObstacle = originalPhysicalObstacles[0]!
      const processedFragments = processedObstaclesByPhysicalIdentity.get(
        identityKey,
      ) ?? [obstacle]
      engineObstacles.push({
        ...originalObstacle,
        // Point-pair preprocessing can split one rotated physical pad into
        // several axis-aligned routing fragments. Candidate DRC must restore
        // the original copper geometry exactly while retaining every alias
        // learned during preprocessing.
        connectedTo: Array.from(
          new Set([
            ...originalObstacle.connectedTo,
            ...processedFragments.flatMap((fragment) => fragment.connectedTo),
          ]),
        ),
      })
      restoredPhysicalObstacleIdentities.add(identityKey)
      continue
    }

    const originalCandidates =
      originalObstaclesByGeometry.get(getObstacleGeometryKey(obstacle)) ?? []
    const originalObstacle =
      originalCandidates.find((candidate) =>
        candidate.connectedTo.some((id) => obstacle.connectedTo.includes(id)),
      ) ?? originalCandidates[0]
    engineObstacles.push(
      originalObstacle ? { ...originalObstacle, ...obstacle } : obstacle,
    )
    const restoredIdentityKey = originalObstacle
      ? getPhysicalObstacleIdentityKey(originalObstacle)
      : undefined
    if (restoredIdentityKey) {
      restoredPhysicalObstacleIdentities.add(restoredIdentityKey)
    }
  }
  for (const [
    identityKey,
    originalPhysicalObstacles,
  ] of originalObstaclesByPhysicalIdentity) {
    if (restoredPhysicalObstacleIdentities.has(identityKey)) continue
    engineObstacles.push(originalPhysicalObstacles[0]!)
  }
  const engineSrj = {
    ...conversionOptions.srjWithPointPairs,
    obstacles: engineObstacles,
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

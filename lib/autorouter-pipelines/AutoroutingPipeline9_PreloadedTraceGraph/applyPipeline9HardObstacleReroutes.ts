import {
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  negotiateTraceClearance,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getPipeline9RouteIndexByTraceId } from "./pipeline9JointDrcRepairUtils"

type Params = {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  connections: SimpleRouteJson["connections"]
  drcEvaluator: DrcEvaluator
  viaHoleDiameter?: number
  maxAttempts: number
}

const REGION_SIZE = 16
const MAX_SEARCH_NODES = 5_000_000

const traceErrorKey = (error: Record<string, unknown>): string => {
  const traceIds = [...getDrcErrorTraceIds(error)].sort()
  if (traceIds.length >= 2) return `pair:${traceIds.join("\u0000")}`
  return typeof error.pcb_trace_error_id === "string"
    ? `error:${error.pcb_trace_error_id}`
    : `trace:${traceIds.join("\u0000")}:${String(error.message)}`
}

const getErrorCenter = (
  error: Record<string, unknown>,
): { x: number; y: number } | undefined => {
  const center = error.center ?? error.pcb_center
  if (
    !center ||
    typeof center !== "object" ||
    !("x" in center) ||
    !("y" in center) ||
    typeof center.x !== "number" ||
    typeof center.y !== "number" ||
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y)
  ) {
    return undefined
  }
  return { x: center.x, y: center.y }
}

/**
 * Reroute one implicated connection while neighboring copper is fixed. The
 * coupled regional pass can improve many errors but cannot publish partial
 * layouts that introduce a new short. This pass makes smaller, independently
 * validated changes to the already published layout instead.
 */
export const applyPipeline9HardObstacleReroutes = ({
  originalSrj,
  routes,
  connections,
  drcEvaluator,
  viaHoleDiameter,
  maxAttempts,
}: Params): HighDensityRoute[] => {
  if (maxAttempts <= 0 || originalSrj.traces?.length) return routes
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  let currentRoutes = routes
  const initialReference = drcEvaluator({
    traces: [],
    routes: currentRoutes,
    hdRoutes: currentRoutes,
  })
  let errors = Array.isArray(initialReference)
    ? initialReference
    : initialReference.errors
  if (!errors.some((error) => error.type === "pcb_via_trace_clearance_error")) {
    return routes
  }
  let attempts = 0
  let searchNodes = 0

  while (attempts < maxAttempts && searchNodes < MAX_SEARCH_NODES) {
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections: connections,
      syntheticConnectionNames: new Set(),
    })
    const fixedViolations = new Map(
      getFixedObstacleViolations({ srj, routes: currentRoutes }).map(
        ({ key, severity }) => [key, severity],
      ),
    )
    const existingTraceErrors = new Set(
      errors
        .filter((error) => error.type === "pcb_trace_error")
        .map(traceErrorKey),
    )
    const existingTraceErrorCount = errors.filter(
      (error) => error.type === "pcb_trace_error",
    ).length
    const visitedTraces = new Set<string>()
    let improved = false

    for (const error of errors
      .filter((error) => error.type === "pcb_via_trace_clearance_error")
      .sort((left, right) => {
        const leftClearance =
          typeof left.actual_clearance === "number" ? left.actual_clearance : 0
        const rightClearance =
          typeof right.actual_clearance === "number"
            ? right.actual_clearance
            : 0
        return leftClearance - rightClearance
      })) {
      const center = getErrorCenter(error)
      if (!center) continue
      for (const traceId of getDrcErrorTraceIds(error)) {
        if (attempts >= maxAttempts || searchNodes >= MAX_SEARCH_NODES) break
        if (visitedTraces.has(traceId)) continue
        visitedTraces.add(traceId)
        const targetIndex = routeIndexByTraceId.get(traceId)
        if (targetIndex === undefined) continue
        const targetName = currentRoutes[targetIndex]!.connectionName
        const region = extractRepairRegion({
          srj,
          routes: currentRoutes,
          bounds: {
            minX: center.x - REGION_SIZE / 2,
            maxX: center.x + REGION_SIZE / 2,
            minY: center.y - REGION_SIZE / 2,
            maxY: center.y + REGION_SIZE / 2,
          },
        })
        const dirtyRouteIndices = region.routes.flatMap((route, index) =>
          route.connectionName === targetName ? [index] : [],
        )
        if (dirtyRouteIndices.length === 0) continue
        const remainingNodes = MAX_SEARCH_NODES - searchNodes
        const repair = negotiateTraceClearance({
          srj: region.srj,
          routes: region.routes,
          bounds: region.mutableBounds,
          dirtyRouteIndices,
          isLocked: (routeIndex, pointIndex) =>
            region.lockedPointIndices[routeIndex]![pointIndex]! ||
            region.routes[routeIndex]!.connectionName !== targetName,
          maxPathSearchCalls: Math.min(8, maxAttempts - attempts),
          maxPathSearchNodes: Math.min(500_000, remainingNodes),
          maxPathSearchNodesPerCall: Math.min(100_000, remainingNodes),
          allowLayerChanges: true,
          traceClearance: RELAXED_DRC_OPTIONS.traceClearance!,
          viaClearance: RELAXED_DRC_OPTIONS.viaClearance!,
          viaHoleDiameter,
        })
        attempts++
        searchNodes += repair.pathSearchNodes
        if (repair.unresolvedSpanCount > 0) continue
        const candidateRoutes = mergeRepairRegion({
          routes: currentRoutes,
          region,
          repairedRoutes: repair.routes,
        })
        if (
          candidateRoutes.every(
            (route, index) => route === currentRoutes[index],
          )
        ) {
          continue
        }
        const candidateReference = drcEvaluator({
          traces: [],
          routes: candidateRoutes,
          hdRoutes: candidateRoutes,
        })
        const candidateErrors = Array.isArray(candidateReference)
          ? candidateReference
          : candidateReference.errors
        if (candidateErrors.length >= errors.length) continue
        const candidateTraceErrors = candidateErrors.filter(
          (candidate) => candidate.type === "pcb_trace_error",
        )
        if (
          candidateTraceErrors.length > existingTraceErrorCount ||
          candidateTraceErrors.some(
            (candidate) => !existingTraceErrors.has(traceErrorKey(candidate)),
          )
        ) {
          continue
        }
        if (
          getFixedObstacleViolations({ srj, routes: candidateRoutes }).some(
            ({ key, severity }) =>
              !fixedViolations.has(key) ||
              severity > fixedViolations.get(key)! + 1e-8,
          ) ||
          getNewViaPadViolations({
            srj,
            previousRoutes: currentRoutes,
            routes: candidateRoutes,
          }).length > 0
        ) {
          continue
        }
        currentRoutes = candidateRoutes
        errors = candidateErrors
        improved = true
        break
      }
      if (
        improved ||
        attempts >= maxAttempts ||
        searchNodes >= MAX_SEARCH_NODES
      )
        break
    }
    if (!improved) break
  }
  return currentRoutes
}

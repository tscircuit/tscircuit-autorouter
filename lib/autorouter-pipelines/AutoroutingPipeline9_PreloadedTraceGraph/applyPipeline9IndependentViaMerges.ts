import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

/** Reuse occupied via sites without requiring unrelated DRC errors to be gone. */
export const applyPipeline9IndependentViaMerges = ({
  originalSrj,
  routes,
  connMap,
  drcEvaluator,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  if (originalSrj.allowBlindAndBuriedVias) return routes
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  let errors = Array.isArray(reference) ? reference : reference.errors
  const traceIds = errors
    .filter((error) => error.type === "pcb_via_clearance_error")
    .flatMap(getDrcErrorTraceIds)
  if (traceIds.length === 0) return routes

  const netByConnectionName = getPipeline9NetByConnectionName(routes, connMap)
  const protectedNets = new Set(
    [
      ...(originalSrj.buses ?? []).flatMap((bus) => bus.connectionNames),
      ...(originalSrj.differentialPairs ?? []).flatMap(
        (pair) => pair.connectionNames,
      ),
    ].map((name) => connMap.getNetConnectedToId(name) ?? name),
  )
  const movable = new Set(
    routes.filter(
      (route) =>
        !protectedNets.has(netByConnectionName.get(route.connectionName)!) &&
        traceIds.some(
          (id) =>
            id === route.connectionName ||
            id.startsWith(`${route.connectionName}_`),
        ),
    ),
  )
  if (movable.size === 0) return routes
  const srj = createSrjWithBoardValidObstacleLayers(originalSrj)
  const movableNames = new Set(
    [...movable].map((route) => route.connectionName),
  )
  let selected = routes
  const { minX, minY, maxX, maxY } = srj.bounds
  while (errors.length > 0) {
    const merger = new SameNetViaMergerSolver({
      inputHdRoutes: selected.filter((route) =>
        movableNames.has(route.connectionName),
      ),
      otherHdRoutes: selected.filter(
        (route) => !movableNames.has(route.connectionName),
      ),
      netByConnectionName,
      connMap,
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      colorMap: {},
      preserveRouteEndpoints: true,
      clearanceConstraints: {
        traceMargin: Math.max(
          RELAXED_DRC_OPTIONS.traceClearance!,
          srj.minTraceToPadEdgeClearance ?? 0,
          srj.defaultObstacleMargin ?? 0,
        ),
        obstacleMargin: Math.max(
          RELAXED_DRC_OPTIONS.traceClearance!,
          srj.minTraceToPadEdgeClearance ?? 0,
          srj.defaultObstacleMargin ?? 0,
        ),
        boardEdgeMargin: srj.minBoardEdgeClearance ?? 0,
      },
      outline: srj.outline ?? [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    })
    let accepted = false
    for (const {
      routes: candidateRoutes,
    } of merger.getClearancePreservingMergeCandidates()) {
      const byName = new Map(
        candidateRoutes.map((route) => [route.connectionName, route]),
      )
      const candidate = selected.map(
        (route) => byName.get(route.connectionName) ?? route,
      )
      const reference = drcEvaluator({
        traces: [],
        routes: candidate,
        hdRoutes: candidate,
      })
      const candidateErrors = Array.isArray(reference)
        ? reference
        : reference.errors
      // The merger checks all changed wires and preserves physical contacts.
      // Via copper only disappears or reuses an equal-diameter occupied site.
      // The reference checker must additionally confirm strict DRC progress.
      if (candidateErrors.length >= errors.length) continue
      selected = candidate
      errors = candidateErrors
      accepted = true
      break
    }
    if (!accepted) break
    // Accepted copper invalidates earlier proposals. Strict DRC progress
    // bounds this loop by the initial number of errors.
  }
  return selected
}

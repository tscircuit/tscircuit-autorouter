import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"
import { isMissingConnectionError } from "./filterPipeline9DrcErrorsAgainstBaseline"

/** Final cleanup only: changing via topology earlier can obstruct regional repair. */
export const applyPipeline9FinalViaMerges = ({
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
  if (
    originalSrj.allowBlindAndBuriedVias ||
    originalSrj.buses?.length ||
    originalSrj.differentialPairs?.length
  ) {
    return routes
  }
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const netByConnectionName = getPipeline9NetByConnectionName(routes, connMap)
  let selected = routes
  let reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  let errors = Array.isArray(reference) ? reference : reference.errors
  while (errors.length > 0) {
    const traceIds = errors
      .filter((error) => error.type === "pcb_via_clearance_error")
      .flatMap(getDrcErrorTraceIds)
    if (traceIds.length === 0) break
    const movable = new Set(
      selected.filter((route) =>
        traceIds.some(
          (id) =>
            id === route.connectionName ||
            id.startsWith(`${route.connectionName}_`),
        ),
      ),
    )
    const merger = new SameNetViaMergerSolver({
      inputHdRoutes: selected.filter((route) => movable.has(route)),
      otherHdRoutes: selected.filter((route) => !movable.has(route)),
      connMap,
      netByConnectionName,
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      colorMap: {},
      preserveRouteEndpoints: true,
      traceMargin: Math.max(
        RELAXED_DRC_OPTIONS.traceClearance!,
        srj.minTraceToPadEdgeClearance ?? 0,
      ),
    })
    const fixedViolations = new Map(
      getFixedObstacleViolations({ srj, routes: selected }).map(
        ({ key, severity }) => [key, severity],
      ),
    )
    let accepted = false
    for (const {
      routes: proposal,
    } of merger.getClearancePreservingMergeCandidates()) {
      const byName = new Map(
        proposal.map((route) => [route.connectionName, route]),
      )
      const candidate = selected.map(
        (route) => byName.get(route.connectionName) ?? route,
      )
      if (
        getFixedObstacleViolations({ srj, routes: candidate }).some(
          ({ key, severity }) =>
            !fixedViolations.has(key) ||
            severity > fixedViolations.get(key)! + 1e-8,
        ) ||
        getNewViaPadViolations({
          srj,
          previousRoutes: selected,
          routes: candidate,
        }).length > 0
      ) {
        continue
      }
      reference = drcEvaluator({
        traces: [],
        routes: candidate,
        hdRoutes: candidate,
      })
      const candidateErrors = Array.isArray(reference)
        ? reference
        : reference.errors
      if (candidateErrors.length >= errors.length) continue
      if (
        candidateErrors.some(
          (error) =>
            candidateErrors.filter((other) => other.type === error.type)
              .length >
              errors.filter((other) => other.type === error.type).length ||
            isMissingConnectionError(error),
        )
      ) {
        continue
      }
      selected = candidate
      errors = candidateErrors
      accepted = true
      break
    }
    // Strict DRC progress bounds accepted moves; rejected proposals never alter copper.
    if (!accepted) break
  }
  return selected
}

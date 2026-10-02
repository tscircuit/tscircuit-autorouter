import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

export type Pipeline9ReportedViaMergesResult = {
  routes: HighDensityRoute[]
  referenceResult: ReturnType<DrcEvaluator>
  referenceValidationCount: number
  accepted: boolean
}

/** Merges reported same-net via conflicts while retaining other DRC work. */
export const applyPipeline9ReportedViaMerges = ({
  srj,
  routes,
  connMap,
  drcEvaluator,
  referenceResult,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
  referenceResult?: ReturnType<DrcEvaluator>
}): Pipeline9ReportedViaMergesResult => {
  const beforeReference =
    referenceResult ??
    drcEvaluator({
      traces: [],
      routes,
      hdRoutes: routes,
    })
  const result: Pipeline9ReportedViaMergesResult = {
    routes,
    referenceResult: beforeReference,
    referenceValidationCount: referenceResult === undefined ? 1 : 0,
    accepted: false,
  }
  const beforeErrors = Array.isArray(beforeReference)
    ? beforeReference
    : beforeReference.errors
  const traceIds = beforeErrors
    .filter((error): boolean => error.type === "pcb_via_clearance_error")
    .flatMap(getDrcErrorTraceIds)
  const movableRoutes = routes.filter((route): boolean =>
    traceIds.some(
      (traceId): boolean =>
        traceId === route.connectionName ||
        traceId.startsWith(`${route.connectionName}_`),
    ),
  )
  if (movableRoutes.length === 0) return result

  const physicalSrj = {
    ...createSrjWithBoardValidObstacleLayers(srj),
    traces: undefined,
  }
  const movable = new Set(movableRoutes)
  const merger = new SameNetViaMergerSolver({
    inputHdRoutes: movableRoutes,
    otherHdRoutes: routes.filter((route): boolean => !movable.has(route)),
    netByConnectionName: getPipeline9NetByConnectionName(routes, connMap),
    obstacles: physicalSrj.obstacles,
    layerCount: physicalSrj.layerCount,
    connMap,
    colorMap: {},
    preserveRouteEndpoints: true,
  })
  merger.solve()
  if (!merger.solved || merger.failed) {
    throw new Error(`Reported via merge failed: ${merger.error}`)
  }
  if (merger.mergedViaHdRoutes.length !== movableRoutes.length) {
    throw new Error("Reported via merge changed the number of route pieces")
  }
  const mergedByRoute = new Map(
    movableRoutes.map((route, index) => [
      route,
      merger.mergedViaHdRoutes[index]!,
    ]),
  )
  const candidateRoutes = routes.map(
    (route): HighDensityRoute => mergedByRoute.get(route) ?? route,
  )
  const beforeFixed = new Map(
    getFixedObstacleViolations({ srj: physicalSrj, routes }).map(
      ({ key, severity }) => [key, severity],
    ),
  )
  const candidateFixed = getFixedObstacleViolations({
    srj: physicalSrj,
    routes: candidateRoutes,
  })
  if (
    !candidateFixed.every(
      ({ key, severity }): boolean =>
        beforeFixed.has(key) && severity <= beforeFixed.get(key)! + 1e-8,
    ) ||
    getNewViaPadViolations({
      srj: physicalSrj,
      previousRoutes: routes,
      routes: candidateRoutes,
    }).length > 0
  ) {
    return result
  }

  const candidateReference = drcEvaluator({
    traces: [],
    routes: candidateRoutes,
    hdRoutes: candidateRoutes,
  })
  result.referenceValidationCount++
  const candidateErrors = Array.isArray(candidateReference)
    ? candidateReference
    : candidateReference.errors
  if (candidateErrors.length >= beforeErrors.length) return result

  return {
    ...result,
    routes: candidateRoutes,
    referenceResult: candidateReference,
    accepted: true,
  }
}

import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  Repair04Solver,
  getRepairJunctionAnchors,
  getRepairViaGeometry,
  preservesDrcClearances,
} from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import { createViaInPadDrcEvaluator } from "lib/utils/autorouting-drc/createViaInPadDrcEvaluator"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { getViaElements } from "./createViaInPadEvaluator"
import {
  getPipeline9DrcErrors,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type RelocationParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: readonly HighDensityRoute[]
  lockedConnectionNames: ReadonlySet<string>
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
}
type RelocationResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
}

/** Delegate drill relocation to repair04, retaining Pipeline9's output validation. */
export function applyPipeline9ViaInPadRelocations({
  srj,
  routes,
  fixedRoutes,
  lockedConnectionNames,
  connMap,
  drcEvaluator,
}: RelocationParams): RelocationResult {
  const unchanged = {
    routes,
    attemptedCandidateCount: 0,
    acceptedCandidateCount: 0,
  }
  if (srj.allowViaInPad === true) return unchanged
  const evaluatePadDrills = createViaInPadDrcEvaluator(
    createPcbPadElements(srj),
  )
  const canonicalRoutes = canonicalizePipeline9HdRoutes(routes)
  const targets = evaluatePadDrills(
    getViaElements({ routes: canonicalRoutes, srj }),
  )
  if (targets.length === 0) return unchanged
  const allRoutes = [
    ...canonicalRoutes,
    ...canonicalizePipeline9HdRoutes([...fixedRoutes]),
  ]
  const bounds = {
    minX: srj.bounds.minX - 5,
    maxX: srj.bounds.maxX + 5,
    minY: srj.bounds.minY - 5,
    maxY: srj.bounds.maxY + 5,
  }
  const junctions = getRepairJunctionAnchors(
    { ...srj, traces: undefined },
    allRoutes.map(
      (route): HighDensityRoute => ({
        ...route,
        rootConnectionName:
          connMap.getNetConnectedToId(
            route.rootConnectionName ?? route.connectionName,
          ) ?? route.rootConnectionName,
      }),
    ),
    bounds,
  )
  const lockedPointIndices = allRoutes.map((route): boolean[] =>
    route.route.map((): boolean => true),
  )
  const movableVias: { routeIndex: number; viaIndex: number }[] = []
  for (let routeIndex = 0; routeIndex < canonicalRoutes.length; routeIndex++) {
    const route = canonicalRoutes[routeIndex]!
    if (lockedConnectionNames.has(route.connectionName)) continue
    const vias = getRepairViaGeometry(route, srj.layerCount)
    const elements = getViaElements({ routes: [route], srj })
    for (let viaIndex = 0; viaIndex < vias.length; viaIndex++) {
      const via = vias[viaIndex]!
      if (evaluatePadDrills([elements[viaIndex]!]).length === 0) continue
      const hasLockedPoint = via.pointIndices.some((index): boolean => {
        const point = route.route[index]!
        return (
          index === 0 ||
          index === route.route.length - 1 ||
          point.pcb_port_id !== undefined ||
          point.terminalApproach !== undefined ||
          point.insideJumperPad === true ||
          point.toNextSegmentType !== undefined
        )
      })
      const isJunction = junctions[routeIndex]!.viaPositions.some(
        (anchor): boolean =>
          Math.hypot(anchor.x - via.x, anchor.y - via.y) < 1e-8,
      )
      if (hasLockedPoint || isJunction) continue
      movableVias.push({ routeIndex, viaIndex })
      for (const index of via.pointIndices) {
        lockedPointIndices[routeIndex]![index] = false
      }
    }
  }
  if (movableVias.length === 0) return unchanged
  const solver = new Repair04Solver(
    {
      srj: { ...srj, traces: undefined },
      routes: allRoutes,
      bounds,
      boundaryMargin: 0.001,
      lockedPointIndices,
      movableVias,
      padDrillRepair: { holeDiameter: getViaDimensions(srj).holeDiameter },
      traceClearance:
        srj.minTraceToPadEdgeClearance ??
        srj.defaultObstacleMargin ??
        RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance: getViaToPadClearance(srj),
      maxCandidates: 64,
      maxCandidateAttempts: 64,
    },
    ({ routes: candidateRoutes }): Pipeline9DrcError[] => {
      if (!candidateRoutes) {
        throw new Error("Pipeline9 pad drill evaluation requires routes")
      }
      return getPipeline9DrcErrors(
        drcEvaluator,
        candidateRoutes.slice(0, canonicalRoutes.length),
      )
    },
  )
  solver.solve()
  if (solver.failed) {
    throw new Error(`Pipeline9 pad drill repair failed: ${solver.error}`)
  }
  const acceptedCandidateCount = Number(solver.stats.accepted)
  let repairedRoutes = routes
  if (acceptedCandidateCount > 0) {
    const candidate = solver.getOutput().slice(0, canonicalRoutes.length)
    const errors = [
      ...getPipeline9DrcErrors(drcEvaluator, canonicalRoutes),
      ...targets,
    ]
    const candidateErrors = [
      ...getPipeline9DrcErrors(drcEvaluator, candidate),
      ...evaluatePadDrills(getViaElements({ routes: candidate, srj })),
    ]
    if (!preservesDrcClearances({ before: errors, after: candidateErrors })) {
      throw new Error("Pipeline9 pad drill repair worsened existing clearances")
    }
    repairedRoutes = candidate
  }
  return {
    routes: repairedRoutes,
    attemptedCandidateCount: Number(solver.stats.candidates),
    acceptedCandidateCount,
  }
}

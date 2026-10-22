import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { DrcEvaluator, SimpleRouteJson as RepairSimpleRouteJson } from "high-density-repair03/lib"
import {
  applyTracePairSegmentDisplacementForError,
  cloneRoutesForIndexes,
  getTraceRoutePairForError,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { Obstacle, SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { filterPipeline9DrcErrorsAgainstBaseline } from "./filterPipeline9DrcErrorsAgainstBaseline"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type Point = { x: number; y: number }
type ContactCandidate = { endpoint: Point; approach: Point }
type TerminalTracePairResult = {
  routes: HighDensityRoute[]
  validationCount: number
  repaired: boolean
  remainingErrorCount: number
}

const MAX_VALIDATIONS = 64
const MAX_DISPLACEMENTS = 8
const COPPER_CONTACT_OVERLAP = 0.01

const pointIsInPad = (point: Point, pad: Obstacle): boolean => {
  return (
    Math.abs(point.x - pad.center.x) <= pad.width / 2 + 1e-9 &&
    Math.abs(point.y - pad.center.y) <= pad.height / 2 + 1e-9
  )
}

const getContactCandidates = (
  pad: Obstacle,
  width: number,
  anchor: Point,
): ContactCandidate[] => {
  const radius = width / 2 - COPPER_CONTACT_OVERLAP
  if (radius <= 0) return []
  const candidates: ContactCandidate[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const angle of [Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8]) {
        const endpoint = {
          x: pad.center.x + sx * (pad.width / 2 + radius * Math.cos(angle)),
          y: pad.center.y + sy * (pad.height / 2 + radius * Math.sin(angle)),
        }
        for (const axis of ["x", "y"] as const) {
          const approach = { ...endpoint }
          approach[axis] += (axis === "x" ? sx : sy) * width
          candidates.push({ endpoint, approach })
        }
      }
    }
  }
  return candidates.sort(
    (a, b) =>
      Math.hypot(a.approach.x - anchor.x, a.approach.y - anchor.y) -
      Math.hypot(b.approach.x - anchor.x, b.approach.y - anchor.y),
  )
}

const hasPairClearance = (
  a: HighDensityRoute,
  b: HighDensityRoute,
  minimum: number,
): boolean => {
  for (let i = 1; i < a.route.length; i++) {
    const a1 = a.route[i - 1]!
    const a2 = a.route[i]!
    if (a1.z !== a2.z) continue
    for (let j = 1; j < b.route.length; j++) {
      const b1 = b.route[j - 1]!
      const b2 = b.route[j]!
      if (b1.z !== b2.z || a1.z !== b1.z) continue
      const gap = segmentToSegmentMinDistance(a1, a2, b1, b2) -
        Math.max(a1.traceThickness ?? a.traceThickness, a2.traceThickness ?? a.traceThickness) / 2 -
        Math.max(b1.traceThickness ?? b.traceThickness, b2.traceThickness ?? b.traceThickness) / 2
      if (gap < minimum) return false
    }
  }
  return true
}

/**
 * A locked terminal center can trap a trace pair even though the round copper
 * endcap can still overlap its pad from outside. Search that contact boundary,
 * then separate the other trace's interior points. Publish only candidates
 * that remove the pair without introducing any reference DRC finding.
 */
export const applyPipeline9TerminalTracePairRepairs = ({
  originalSrj,
  routes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
  initialErrors,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  initialErrors: Pipeline9DrcError[]
}): TerminalTracePairResult => {
  const unchanged: TerminalTracePairResult = {
    routes,
    validationCount: 0,
    repaired: false,
    remainingErrorCount: initialErrors.length,
  }
  // Keep this final local search bounded, and leave clean boards untouched.
  if (initialErrors.length === 0 || initialErrors.length > 8) return unchanged
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections,
    syntheticConnectionNames,
  })
  for (const initialError of initialErrors) {
    if (initialError.type !== "pcb_trace_error") continue
    const pair = getTraceRoutePairForError(initialError, routeIndexByTraceId)
    if (!pair) continue
    const minimumClearance = typeof initialError.minimum_clearance === "number"
      ? initialError.minimum_clearance
      : RELAXED_DRC_OPTIONS.traceClearance!
    if (pair.some((i) =>
      syntheticConnectionNames.has(routes[i]!.connectionName) ||
      routes[i]!.jumpers?.length ||
      routes[i]!.route.some((point) => point.toNextSegmentType),
    )) {
      continue
    }
    for (const terminalSide of [0, 1] as const) {
      const terminalIndex = pair[terminalSide]
      const movingIndex = pair[terminalSide === 0 ? 1 : 0]
      const terminalRoute = routes[terminalIndex]!
      if (terminalRoute.route.length < 2) continue
      for (const reverse of [false, true]) {
        const ordered = reverse ? [...terminalRoute.route].reverse() : terminalRoute.route
        const endpoint = ordered.at(-1)!
        if (!endpoint?.pcb_port_id) continue
        const layer = mapZToLayerName(endpoint.z, originalSrj.layerCount)
        const pad = originalSrj.obstacles.find(
          (obstacle) =>
            !obstacle.shape && !obstacle.ccwRotationDegrees &&
            !obstacle.isNonPlatedHole && !obstacle.isCopperPour &&
            !obstacle.isFanoutSourceKeepout &&
            obstacle.width > 0 && obstacle.height > 0 &&
            obstacle.layers.includes(layer) &&
            obstacle.connectedTo.includes(endpoint.pcb_port_id!) &&
            pointIsInPad(endpoint, obstacle),
        )
        if (!pad) continue
        // Only search the constrained terminal shared by this trace pair and
        // an existing pad violation on the other trace.
        const constrained = initialErrors.some((error) => {
          const center = error.center as Point | undefined
          return (
            routeIndexByTraceId.get(String(error.pcb_trace_id)) === movingIndex &&
            String(error.pcb_trace_error_id).includes("_pcb_smtpad_") &&
            center !== undefined && Number.isFinite(center.x) &&
            Number.isFinite(center.y) && pointIsInPad(center, pad)
          )
        })
        if (!constrained) continue
        const width = terminalRoute.traceThickness
        if (!Number.isFinite(width) || width <= 0) continue
        const trimDistance = Math.hypot(pad.width, pad.height) + width
        let anchorIndex = ordered.length - 2
        while (anchorIndex > 0) {
          const point = ordered[anchorIndex]!
          if (
            point.z !== endpoint.z || point.pcb_port_id || point.toNextSegmentType ||
            terminalRoute.vias.some((via) => Math.hypot(via.x - point.x, via.y - point.y) < 1e-9) ||
            Math.hypot(point.x - pad.center.x, point.y - pad.center.y) > trimDistance
          ) break
          anchorIndex--
        }
        const tail = ordered.slice(anchorIndex)
        if (tail.some((point) =>
          point.z !== endpoint.z || point.toNextSegmentType ||
          (point.traceThickness !== undefined && point.traceThickness !== width),
        )) continue
        for (const contact of getContactCandidates(pad, width, ordered[anchorIndex]!)) {
          const candidate = cloneRoutesForIndexes(routes, pair)
          const replacedTail = [
            ...ordered.slice(0, anchorIndex + 1),
            { ...endpoint, ...contact.approach, pcb_port_id: undefined },
            { ...endpoint, ...contact.endpoint },
          ]
          candidate[terminalIndex]!.route = reverse ? replacedTail.reverse() : replacedTail
          for (let pass = 0; pass <= MAX_DISPLACEMENTS; pass++) {
            if (unchanged.validationCount >= MAX_VALIDATIONS) return unchanged
            unchanged.validationCount++
            const errors = getPipeline9DrcErrors(drcEvaluator, candidate)
            const newErrors = filterPipeline9DrcErrorsAgainstBaseline({
              errors,
              baselineErrors: initialErrors,
            })
            const pairError = errors.find((error) => {
              const currentPair = getTraceRoutePairForError(error, routeIndexByTraceId)
              return currentPair?.includes(terminalIndex) && currentPair.includes(movingIndex)
            })
            if (
              !pairError && newErrors.length === 0 && errors.length < initialErrors.length &&
              hasPairClearance(candidate[pair[0]]!, candidate[pair[1]]!, minimumClearance)
            ) {
              return {
                routes: candidate,
                validationCount: unchanged.validationCount,
                repaired: true,
                remainingErrorCount: errors.length,
              }
            }
            if (!pairError || newErrors.length > 0 || pass === MAX_DISPLACEMENTS) break
            const currentPair = getTraceRoutePairForError(pairError, routeIndexByTraceId)!
            const displaced = applyTracePairSegmentDisplacementForError(
              originalSrj as RepairSimpleRouteJson, candidate,
              { ...pairError, minimum_clearance: minimumClearance + 0.001 },
              routeIndexByTraceId,
              currentPair[0] === movingIndex ? 0 : 1,
            )
            if (!displaced) break
          }
        }
      }
    }
  }
  return unchanged
}

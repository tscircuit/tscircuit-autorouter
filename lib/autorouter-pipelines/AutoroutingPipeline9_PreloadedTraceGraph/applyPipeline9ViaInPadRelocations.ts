import type { DrcEvaluator } from "high-density-repair03/lib"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
  type IndexedObstacle,
} from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import {
  createPcbPadElements,
  extractViasFromRoutes,
} from "lib/utils/convertToCircuitJson"
import {
  createViaInPadDrcEvaluator,
  type ViaInPadDrcError,
} from "lib/utils/autorouting-drc/createViaInPadDrcEvaluator"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import {
  getPipeline9DrcErrors,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type Point = { x: number; y: number }
type OwnedPadDrillError = ViaInPadDrcError & { routeIndex: number }
type RelocationParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
}
type RelocationResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
}

const MAX_CANDIDATE_EVALUATIONS = 64
const HOLE_EDGE_MARGIN = 1e-4

/** Locate the drill boundary using the same pad geometry as validation. */
function getDrillBoundaryPoint({
  pad,
  holeDiameter,
  angle,
}: {
  pad: IndexedObstacle
  holeDiameter: number
  angle: number
}): Point {
  const center = {
    x: (pad.minX + pad.maxX) / 2,
    y: (pad.minY + pad.maxY) / 2,
  }
  let lower = 0
  let upper =
    Math.hypot(pad.maxX - pad.minX, pad.maxY - pad.minY) / 2 +
    holeDiameter / 2 +
    HOLE_EDGE_MARGIN
  for (let iteration = 0; iteration < 32; iteration++) {
    const radius = (lower + upper) / 2
    const point = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    }
    const clearance = getTraceObstacleClearance(
      point,
      point,
      holeDiameter,
      pad,
    )
    if (clearance.gap < HOLE_EDGE_MARGIN) lower = radius
    else upper = radius
  }
  return {
    x: center.x + upper * Math.cos(angle),
    y: center.y + upper * Math.sin(angle),
  }
}

/** Preserve every residual pair and its measured gap while removing a drill. */
function preservesResidualClearance({
  errors,
  candidateErrors,
}: {
  errors: Pipeline9DrcError[]
  candidateErrors: Pipeline9DrcError[]
}): boolean {
  if (candidateErrors.length >= errors.length) return false
  const unmatched = [...errors]
  for (const error of candidateErrors) {
    const id = error[`${error.type}_id`] ?? error.pcb_error_id
    if (typeof id !== "string") return false
    const index = unmatched.findIndex(
      (previous) =>
        previous.type === error.type &&
        (previous[`${previous.type}_id`] ?? previous.pcb_error_id) === id,
    )
    if (index < 0) return false
    const previous = unmatched.splice(index, 1)[0]!
    if (
      typeof previous.actual_clearance === "number" &&
      (typeof error.actual_clearance !== "number" ||
        error.actual_clearance < previous.actual_clearance - 1e-9)
    ) {
      return false
    }
  }
  return true
}

/** Move existing drilled holes out of pads without moving ports or junctions. */
export function applyPipeline9ViaInPadRelocations({
  srj,
  routes,
  drcEvaluator,
}: RelocationParams): RelocationResult {
  const result = {
    routes,
    attemptedCandidateCount: 0,
    acceptedCandidateCount: 0,
  }
  if (srj.allowViaInPad === true) return result
  const pads = new Map(
    createPcbPadElements(srj)
      .filter(
        (element) =>
          element.type === "pcb_smtpad" ||
          element.type === "pcb_plated_hole",
      )
      .map(compileTraceClearanceObstacle)
      .map((pad) => [pad.id, pad]),
  )
  const dimensions = getViaDimensions(srj)
  const { holeDiameter } = dimensions
  const evaluatePadDrills = createViaInPadDrcEvaluator(
    [...pads.values()].map((pad) => pad.element),
  )
  const getPadDrillErrors = (
    candidate: HighDensityRoute[],
  ): OwnedPadDrillError[] => {
    const owners = new Map<string, number>()
    const vias = candidate.flatMap((route, routeIndex) =>
      extractViasFromRoutes(
        [route],
        srj.layerCount,
        dimensions.padDiameter,
        holeDiameter,
        srj.allowBlindAndBuriedVias === true,
      ).map((via, viaIndex) => {
        const id = `pad_drill_${routeIndex}_${viaIndex}`
        owners.set(id, routeIndex)
        return { ...via, pcb_via_id: id }
      }),
    )
    return evaluatePadDrills(vias).map((error) => ({
      ...error,
      routeIndex: owners.get(error.pcb_via_id)!,
    }))
  }
  const targets = getPadDrillErrors(routes)
  if (targets.length === 0) return result
  let errors = [...getPipeline9DrcErrors(drcEvaluator, routes), ...targets]
  const traceClearance =
    srj.minTraceToPadEdgeClearance ??
    srj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance
  const viaClearance = getViaToPadClearance(srj)
  const obstacleSrj = { ...srj, traces: undefined }
  for (const target of targets) {
    const center = target.center
    const routeIndex = target.routeIndex
    const pad = pads.get(target.pcb_pad_id)
    if (!pad) throw new Error("Pipeline9 pad drill repair lost its pad")
    const route = result.routes[routeIndex]!
    const indices = route.route.flatMap((point, index) =>
      point.x === center.x && point.y === center.y ? [index] : [],
    )
    if (
      indices.length < 2 ||
      indices.some((index) => {
        const point = route.route[index]!
        return (
          index === 0 ||
          index === route.route.length - 1 ||
          point.pcb_port_id !== undefined ||
          point.terminalApproach !== undefined ||
          point.insideJumperPad ||
          point.toNextSegmentType !== undefined
        )
      }) ||
      result.routes.some(
        (other) =>
          other !== route &&
          other.route.some((point, index) => {
            if (point.x === center.x && point.y === center.y) return true
            const previous = other.route[index - 1]
            const sharedNet =
              (other.rootConnectionName ?? other.connectionName) ===
              (route.rootConnectionName ?? route.connectionName)
            return (
              sharedNet &&
              previous !== undefined &&
              previous.z === point.z &&
              pointToSegmentDistance(center, previous, point) <=
                (route.viaDiameter + other.traceThickness) / 2
            )
          }),
      )
    ) {
      continue
    }
    const angle = Math.atan2(
      center.y - (pad.minY + pad.maxY) / 2,
      center.x - (pad.minX + pad.maxX) / 2,
    )
    const fixedViolations = new Map(
      getFixedObstacleViolations({
        srj: obstacleSrj,
        routes: [route],
        traceClearance,
        viaClearance,
      }).map((violation) => [violation.key, violation.severity]),
    )
    for (let direction = 0; direction < 16; direction++) {
      if (result.attemptedCandidateCount >= MAX_CANDIDATE_EVALUATIONS) {
        return result
      }
      const point = getDrillBoundaryPoint({
        pad,
        holeDiameter,
        angle: angle + (direction * Math.PI) / 8,
      })
      const candidate = [...result.routes]
      candidate[routeIndex] = {
        ...route,
        route: route.route.map((previous, index) =>
          indices.includes(index) ? { ...previous, ...point } : previous,
        ),
        vias: route.vias.map((via) =>
          via.x === center.x && via.y === center.y ? point : via,
        ),
      }
      result.attemptedCandidateCount++
      const worsensFixedCopper = getFixedObstacleViolations({
        srj: obstacleSrj,
        routes: [candidate[routeIndex]!],
        traceClearance,
        viaClearance,
      }).some(
        ({ key, severity }) =>
          !fixedViolations.has(key) ||
          severity > fixedViolations.get(key)! + 1e-8,
      )
      if (worsensFixedCopper) continue
      const candidateErrors = [
        ...getPipeline9DrcErrors(drcEvaluator, candidate),
        ...getPadDrillErrors(candidate),
      ]
      if (
        candidateErrors.some(
          (error) =>
            error.pcb_placement_error_id === target.pcb_placement_error_id,
        ) ||
        !preservesResidualClearance({ errors, candidateErrors })
      ) {
        continue
      }
      result.routes = candidate
      result.acceptedCandidateCount++
      errors = candidateErrors
      break
    }
  }
  return result
}

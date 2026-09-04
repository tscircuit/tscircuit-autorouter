import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  type Pipeline9DrcError,
  clonePipeline9HdRoutes,
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

const MAX_RELOCATION_PASSES = 8
const CANDIDATE_ANGLES = Array.from(
  { length: 32 },
  (_, angleIndex) => (angleIndex * Math.PI) / 16,
)
const CANDIDATE_RADIUS_FACTORS = [0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]

type TerminalTransition = {
  endpoint: HighDensityRoute["route"][number]
  transitionPointIndex: number
}

const materializeRouteVias = (route: HighDensityRoute): HighDensityRoute => {
  const vias: HighDensityRoute["vias"] = []
  for (const [pointIndex, point] of route.route.slice(0, -1).entries()) {
    const nextPoint = route.route[pointIndex + 1]!
    if (
      point.toNextSegmentType === "through_obstacle" ||
      point.x !== nextPoint.x ||
      point.y !== nextPoint.y ||
      point.z === nextPoint.z
    ) {
      continue
    }
    const previousVia = vias.at(-1)
    if (previousVia?.x === point.x && previousVia.y === point.y) continue
    vias.push({ x: point.x, y: point.y })
  }
  return { ...route, vias }
}

const isViaToPadError = (error: Pipeline9DrcError) =>
  error.type === "pcb_pad_pad_clearance_error" &&
  Array.isArray(error.pcb_via_ids) &&
  error.pcb_via_ids.length === 1

const getErrorCenter = (error: Pipeline9DrcError) => {
  const center = error.center
  if (!center || typeof center !== "object") return undefined
  const point = center as Record<string, unknown>
  return typeof point.x === "number" && typeof point.y === "number"
    ? { x: point.x, y: point.y }
    : undefined
}

const getTerminalTransition = (
  route: HighDensityRoute,
  error: Pipeline9DrcError,
): TerminalTransition | undefined => {
  const center = getErrorCenter(error)
  if (!center || route.route.length < 4) return undefined

  const candidates: TerminalTransition[] = []
  const first = route.route[0]!
  const startBeforeVia = route.route[1]
  const startAfterVia = route.route[2]
  if (
    first.pcb_port_id &&
    startBeforeVia &&
    startAfterVia &&
    startBeforeVia.x === startAfterVia.x &&
    startBeforeVia.y === startAfterVia.y &&
    startBeforeVia.z !== startAfterVia.z
  ) {
    candidates.push({ endpoint: first, transitionPointIndex: 1 })
  }

  const last = route.route.at(-1)!
  const endBeforeVia = route.route.at(-3)
  const endAfterVia = route.route.at(-2)
  if (
    last.pcb_port_id &&
    endBeforeVia &&
    endAfterVia &&
    endBeforeVia.x === endAfterVia.x &&
    endBeforeVia.y === endAfterVia.y &&
    endBeforeVia.z !== endAfterVia.z
  ) {
    candidates.push({
      endpoint: last,
      transitionPointIndex: route.route.length - 3,
    })
  }

  return candidates.sort((left, right) => {
    const leftPoint = route.route[left.transitionPointIndex]!
    const rightPoint = route.route[right.transitionPointIndex]!
    return (
      Math.hypot(leftPoint.x - center.x, leftPoint.y - center.y) -
      Math.hypot(rightPoint.x - center.x, rightPoint.y - center.y)
    )
  })[0]
}

/**
 * Legalizes terminal vias introduced by a safe trace-layer move. The upstream
 * move generator places each via just outside its terminal pad, which can put
 * it inside a neighboring pad on fine-pitch packages. Candidate positions are
 * sampled radially around the same terminal and accepted only when whole-board
 * DRC improves.
 */
export const applyPipeline7TerminalViaRelocations = ({
  srj,
  routes,
  newConnections,
  drcEvaluator,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  drcEvaluator: DrcEvaluator
}) => {
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0

  for (
    let pass = 0;
    pass < MAX_RELOCATION_PASSES && currentErrors.length > 0;
    pass += 1
  ) {
    let acceptedOnPass = false
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames: new Set(),
    })

    for (const error of currentErrors.filter(isViaToPadError)) {
      if (typeof error.pcb_trace_id !== "string") continue
      const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id)
      if (routeIndex === undefined) continue
      const route = currentRoutes[routeIndex]
      if (!route) continue
      const terminalTransition = getTerminalTransition(route, error)
      if (!terminalTransition) continue

      const currentVia = route.route[terminalTransition.transitionPointIndex]!
      const currentRadius = Math.hypot(
        currentVia.x - terminalTransition.endpoint.x,
        currentVia.y - terminalTransition.endpoint.y,
      )
      if (currentRadius <= 0) continue

      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const radiusFactor of CANDIDATE_RADIUS_FACTORS) {
        const radius = currentRadius * radiusFactor
        for (const angle of CANDIDATE_ANGLES) {
          const point = {
            x: terminalTransition.endpoint.x + Math.cos(angle) * radius,
            y: terminalTransition.endpoint.y + Math.sin(angle) * radius,
          }
          const viaRadius = route.viaDiameter / 2
          if (
            point.x - viaRadius < srj.bounds.minX ||
            point.x + viaRadius > srj.bounds.maxX ||
            point.y - viaRadius < srj.bounds.minY ||
            point.y + viaRadius > srj.bounds.maxY
          ) {
            continue
          }

          const candidateRoutes = clonePipeline9HdRoutes(currentRoutes)
          const candidateRoute = candidateRoutes[routeIndex]!
          Object.assign(
            candidateRoute.route[terminalTransition.transitionPointIndex]!,
            point,
          )
          Object.assign(
            candidateRoute.route[terminalTransition.transitionPointIndex + 1]!,
            point,
          )
          candidateRoutes[routeIndex] = materializeRouteVias(candidateRoute)
          const materializedCandidateRoutes = candidateRoutes
          const candidateErrors = getPipeline9DrcErrors(
            drcEvaluator,
            materializedCandidateRoutes,
          )
          attemptedCandidateCount += 1
          if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
            bestRoutes = materializedCandidateRoutes
            bestErrors = candidateErrors
            if (bestErrors.length === 0) break
          }
        }
        if (bestErrors.length === 0) break
      }

      if (bestRoutes !== currentRoutes) {
        currentRoutes = bestRoutes
        currentErrors = bestErrors
        acceptedCandidateCount += 1
        acceptedOnPass = true
        break
      }
    }

    if (!acceptedOnPass) break
  }

  return {
    routes: currentRoutes,
    errors: currentErrors,
    attemptedCandidateCount,
    acceptedCandidateCount,
  }
}

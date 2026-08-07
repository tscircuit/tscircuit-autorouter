import type { DrcEvaluator } from "high-density-repair03/lib"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  clonePipeline9HdRoutes,
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type TerminalEscapeRelocationResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
}

type Point = { x: number; y: number }

const CANDIDATE_RADIAL_FACTORS = [0.9, 0.72]
const CANDIDATE_ANGLES = Array.from(
  { length: 16 },
  (_, angleIndex) => (angleIndex * Math.PI) / 8,
)

const isObstacleTraceError = (error: Pipeline9DrcError) => {
  if (error.type === "pcb_pad_trace_clearance_error") return true
  if (error.type !== "pcb_trace_error") return false
  return !(
    Array.isArray(error.pcb_trace_ids) && error.pcb_trace_ids.length >= 2
  )
}

const getErrorObstacleId = (error: Pipeline9DrcError) => {
  if (typeof error.pcb_pad_id === "string") return error.pcb_pad_id
  if (typeof error.pcb_trace_error_id === "string") {
    const id = error.pcb_trace_error_id.match(
      /(pcb_(?:smtpad|plated_hole|hole|keepout)_\d+)$/,
    )?.[1]
    if (id) return id
  }
  const message = typeof error.message === "string" ? error.message : ""
  return message.match(
    /(?:pcb_smtpad|pcb_plated_hole|pcb_hole|pcb_keepout)\[#?([^\]"]+)\]/,
  )?.[1]
}

const getObstacleById = (
  srj: SimpleRouteJson,
  obstacleId: string | undefined,
) => {
  if (!obstacleId) return undefined
  const normalizedId = obstacleId.startsWith("pcb_")
    ? obstacleId
    : `pcb_${obstacleId}`
  return srj.obstacles.find(
    (obstacle) =>
      obstacle.obstacleId === normalizedId ||
      obstacle.connectedTo[0] === normalizedId,
  )
}

const getPcbPortPositionMap = (srj: SimpleRouteJson) => {
  const portPositionMap = new Map<string, Point>()
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (point.pcb_port_id) {
        portPositionMap.set(point.pcb_port_id, point)
      }
    }
  }
  return portPositionMap
}

/**
 * SRJ obstacles carry the whole net in connectedTo, so the pcb_port_id narrows
 * the candidates and the registered port position selects its actual pad. This
 * is the same identity resolution used when SRJ obstacles become Circuit JSON.
 */
const getTerminalObstacle = ({
  srj,
  pcbPortId,
  z,
  portPositionMap,
}: {
  srj: SimpleRouteJson
  pcbPortId: string
  z: number
  portPositionMap: ReadonlyMap<string, Point>
}): Obstacle | undefined => {
  const layer = mapZToLayerName(z, srj.layerCount)
  const portPosition = portPositionMap.get(pcbPortId)
  const candidates = srj.obstacles.filter(
    (obstacle) =>
      obstacle.layers.includes(layer) &&
      obstacle.connectedTo.includes(pcbPortId),
  )
  if (!portPosition) return candidates[0]
  return candidates.reduce<Obstacle | undefined>((nearest, candidate) => {
    if (!nearest) return candidate
    return Math.hypot(
      candidate.center.x - portPosition.x,
      candidate.center.y - portPosition.y,
    ) <
      Math.hypot(
        nearest.center.x - portPosition.x,
        nearest.center.y - portPosition.y,
      )
      ? candidate
      : nearest
  }, undefined)
}

const rotatePoint = (point: Point, radians: number): Point => ({
  x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
  y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
})

const getTerminalCandidates = ({
  terminalObstacle,
  conflictingObstacle,
  traceRadius,
}: {
  terminalObstacle: Obstacle
  conflictingObstacle: Obstacle
  traceRadius: number
}) => {
  const halfWidth = Math.max(0, terminalObstacle.width / 2 - traceRadius)
  const halfHeight = Math.max(0, terminalObstacle.height / 2 - traceRadius)
  const rotationRadians =
    ((terminalObstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const candidates = CANDIDATE_RADIAL_FACTORS.flatMap((radialFactor) =>
    CANDIDATE_ANGLES.map((angle) => {
      const localPoint = {
        x: Math.cos(angle) * halfWidth * radialFactor,
        y: Math.sin(angle) * halfHeight * radialFactor,
      }
      const rotatedPoint = rotatePoint(localPoint, rotationRadians)
      return {
        x: terminalObstacle.center.x + rotatedPoint.x,
        y: terminalObstacle.center.y + rotatedPoint.y,
      }
    }),
  )
  return candidates
    .sort(
      (left, right) =>
        Math.hypot(
          right.x - conflictingObstacle.center.x,
          right.y - conflictingObstacle.center.y,
        ) -
        Math.hypot(
          left.x - conflictingObstacle.center.x,
          left.y - conflictingObstacle.center.y,
        ),
    )
    .slice(0, 16)
}

const createTerminalCandidate = ({
  routes,
  routeIndex,
  endpointIndex,
  point,
  bounds,
  collapseAdjacent,
}: {
  routes: HighDensityRoute[]
  routeIndex: number
  endpointIndex: 0 | -1
  point: Point
  bounds: SimpleRouteJson["bounds"]
  collapseAdjacent: boolean
}): HighDensityRoute[] | undefined => {
  const candidateRoutes = clonePipeline9HdRoutes(routes)
  const route = candidateRoutes[routeIndex]
  if (!route || route.route.length < 2) return undefined
  const pointIndex = endpointIndex === 0 ? 0 : route.route.length - 1
  const adjacentPointIndex = endpointIndex === 0 ? 1 : pointIndex - 1
  const endpoint = route.route[pointIndex]
  const adjacentPoint = route.route[adjacentPointIndex]
  if (!endpoint || !adjacentPoint || endpoint.z !== adjacentPoint.z) {
    return undefined
  }
  const radius = route.traceThickness / 2
  if (
    point.x - radius < bounds.minX ||
    point.x + radius > bounds.maxX ||
    point.y - radius < bounds.minY ||
    point.y + radius > bounds.maxY
  ) {
    return undefined
  }
  route.route[pointIndex] = { ...endpoint, ...point }
  if (collapseAdjacent) {
    const nextInteriorPointIndex =
      endpointIndex === 0 ? adjacentPointIndex + 1 : adjacentPointIndex - 1
    const nextInteriorPoint = route.route[nextInteriorPointIndex]
    const adjacentIsVia = route.vias.some(
      (via) => via.x === adjacentPoint.x && via.y === adjacentPoint.y,
    )
    if (
      !nextInteriorPoint ||
      nextInteriorPoint.z !== endpoint.z ||
      adjacentPoint.pcb_port_id !== undefined ||
      adjacentIsVia
    ) {
      return undefined
    }
    route.route[adjacentPointIndex] = { ...adjacentPoint, ...point }
  }
  return candidateRoutes
}

/**
 * Relocates a trace terminal only inside its own pad when a different-net pad
 * overlaps the current escape side. Every candidate is accepted by joint DRC.
 */
export const applyPipeline9TerminalEscapeRelocations = ({
  srj,
  routes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
}): TerminalEscapeRelocationResult => {
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  const portPositionMap = getPcbPortPositionMap(srj)

  for (let pass = 0; pass < 2; pass++) {
    let acceptedOnPass = false
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    for (const error of currentErrors.filter(isObstacleTraceError)) {
      if (typeof error.pcb_trace_id !== "string") continue
      const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id)
      const conflictingObstacle = getObstacleById(
        srj,
        getErrorObstacleId(error),
      )
      if (routeIndex === undefined || !conflictingObstacle) continue
      const route = currentRoutes[routeIndex]!

      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const endpointIndex of [0, -1] as const) {
        const endpoint =
          endpointIndex === 0 ? route.route[0] : route.route.at(-1)
        if (!endpoint || typeof endpoint.pcb_port_id !== "string") continue
        const terminalObstacle = getTerminalObstacle({
          srj,
          pcbPortId: endpoint.pcb_port_id,
          z: endpoint.z,
          portPositionMap,
        })
        if (!terminalObstacle || terminalObstacle === conflictingObstacle) {
          continue
        }
        const maximumRelevantDistance =
          Math.hypot(conflictingObstacle.width, conflictingObstacle.height) /
            2 +
          Math.hypot(terminalObstacle.width, terminalObstacle.height) / 2 +
          0.5
        if (
          Math.hypot(
            endpoint.x - conflictingObstacle.center.x,
            endpoint.y - conflictingObstacle.center.y,
          ) > maximumRelevantDistance
        ) {
          continue
        }
        for (const point of getTerminalCandidates({
          terminalObstacle,
          conflictingObstacle,
          traceRadius: route.traceThickness / 2,
        })) {
          for (const collapseAdjacent of [false, true]) {
            const candidateRoutes = createTerminalCandidate({
              routes: currentRoutes,
              routeIndex,
              endpointIndex,
              point,
              bounds: srj.bounds,
              collapseAdjacent,
            })
            if (!candidateRoutes) continue
            attemptedCandidateCount++
            const candidateErrors = getPipeline9DrcErrors(
              drcEvaluator,
              candidateRoutes,
            )
            if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
              bestRoutes = candidateRoutes
              bestErrors = candidateErrors
            }
          }
        }
      }
      if (bestRoutes !== currentRoutes) {
        currentRoutes = bestRoutes
        currentErrors = bestErrors
        acceptedCandidateCount++
        acceptedOnPass = true
      }
    }
    if (!acceptedOnPass || currentErrors.length === 0) break
  }

  return {
    routes: currentRoutes,
    attemptedCandidateCount,
    acceptedCandidateCount,
  }
}

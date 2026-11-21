import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isPointInCopperObstacle } from "lib/utils/isPointInCopperObstacle"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Point = { x: number; y: number }
type RoutePoint = HighDensityRoute["route"][number]
const CONTACT_TOLERANCE = 1e-6
const ANGLE_COUNT = 16
const MAX_VIA_SEARCH_GRID_RADIUS = 32

function needsCopperWitness(
  route: HighDensityRoute,
  start: RoutePoint,
  end: RoutePoint,
): boolean {
  return (
    start.z !== end.z &&
    (start.toNextSegmentType === "through_obstacle" ||
      !route.vias.some(
        (via) =>
          Math.abs(via.x - end.x) < 0.001 &&
          Math.abs(via.y - end.y) < 0.001,
      ))
  )
}

function hasLayerTransitionToCheck(route: HighDensityRoute): boolean {
  return route.route.some((start, index) => {
    const end = route.route[index + 1]
    return end !== undefined && needsCopperWitness(route, start, end)
  })
}

function getCopperContactPoints(
  obstacle: Obstacle,
  origin: Point,
  traceRadius: number,
): Point[] {
  const bearing = Math.atan2(
    origin.y - obstacle.center.y,
    origin.x - obstacle.center.x,
  )
  return Array.from({ length: ANGLE_COUNT }, (_, index) => {
    const angle = bearing + (index * 2 * Math.PI) / ANGLE_COUNT
    const offset = { x: Math.cos(angle), y: Math.sin(angle) }
    const pointAt = (radius: number): Point => ({
      x: obstacle.center.x + radius * offset.x,
      y: obstacle.center.y + radius * offset.y,
    })
    let inner = 0
    let outer = Math.hypot(obstacle.width, obstacle.height)
    while (outer - inner > CONTACT_TOLERANCE) {
      const middle = (inner + outer) / 2
      if (isPointInCopperObstacle(obstacle, pointAt(middle))) inner = middle
      else outer = middle
    }
    return pointAt(Math.max(0, inner - traceRadius))
  })
}

function getViaCandidates(
  start: RoutePoint,
  end: RoutePoint,
  viaDiameter: number,
  traceWidth: number,
): Point[] {
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  // Search at half a trace width so narrow channels between pads can be used.
  const searchRadius = 2 * viaDiameter
  const step = Math.max(
    traceWidth / 2,
    searchRadius / MAX_VIA_SEARCH_GRID_RADIUS,
  )
  const limit = Math.floor(searchRadius / step)
  const offsets: Point[] = []
  for (let x = -limit; x <= limit; x++) {
    for (let y = -limit; y <= limit; y++) {
      if (Math.hypot(x, y) <= limit) offsets.push({ x, y })
    }
  }
  return offsets
    .sort((a, b) => a.x ** 2 + a.y ** 2 - b.x ** 2 - b.y ** 2)
    .map(({ x, y }) => ({ x: center.x + x * step, y: center.y + y * step }))
}

function replaceLayerTransition(
  route: HighDensityRoute,
  index: number,
  contact: Point,
  copper?: Obstacle,
): HighDensityRoute {
  const start = route.route[index]!
  const end = route.route[index + 1]!
  const previous = route.route[index - 1]
  const following = route.route[index + 2]
  const {
    toNextSegmentType: _oldTransition,
    toNextSegmentCircuitJsonMetadata: _oldCopper,
    ...wireStart
  } = start
  const relocateStart =
    previous?.z === start.z &&
    !previous.toNextSegmentType &&
    !start.pcb_port_id &&
    !start.terminalApproach &&
    !start.insideJumperPad
  const relocateEnd =
    following?.z === end.z &&
    !end.toNextSegmentType &&
    !end.pcb_port_id &&
    !end.terminalApproach &&
    !end.insideJumperPad
  const startMatches = start.x === contact.x && start.y === contact.y
  const endMatches = end.x === contact.x && end.y === contact.y
  const keepStartLead = !startMatches && !relocateStart
  const keepEndLead = !endMatches && !relocateEnd
  const contactStart: RoutePoint = {
    ...(keepStartLead
      ? { z: start.z, traceThickness: start.traceThickness }
      : wireStart),
    ...contact,
    ...(copper && {
      toNextSegmentType: "through_obstacle",
      toNextSegmentCircuitJsonMetadata: copper.circuitJsonMetadata,
    }),
  }
  const contactEnd: RoutePoint = {
    ...(keepEndLead ? { z: end.z, traceThickness: end.traceThickness } : end),
    ...contact,
  }
  const vias = route.vias.filter((via) => {
    if (
      distance(start, via) > CONTACT_TOLERANCE &&
      distance(end, via) > CONTACT_TOLERANCE
    ) {
      return true
    }
    return route.route.some((other, otherIndex) => {
      const next = route.route[otherIndex + 1]
      return (
        otherIndex !== index &&
        next !== undefined &&
        other.z !== next.z &&
        other.toNextSegmentType !== "through_obstacle" &&
        distance(other, via) <= CONTACT_TOLERANCE &&
        distance(next, via) <= CONTACT_TOLERANCE
      )
    })
  })
  return {
    ...route,
    route: [
      ...route.route.slice(0, index),
      ...(keepStartLead ? [wireStart] : []),
      contactStart,
      contactEnd,
      ...(keepEndLead ? [end] : []),
      ...route.route.slice(index + 2),
    ],
    vias: copper || vias.some((via) => distance(via, contact) <= CONTACT_TOLERANCE)
      ? vias
      : [...vias, contact],
  }
}

/** Validates layer changes against actual copper after routing with pad bounds. */
export function repairPipeline9ThroughObstacleTransitions({
  hdRoutes,
  physicalObstacles,
  connMap,
  layerCount,
  isValid,
}: {
  hdRoutes: HighDensityRoute[]
  physicalObstacles: readonly Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  isValid: (routes: HighDensityRoute[]) => boolean
}): HighDensityRoute[] {
  if (!hdRoutes.some(hasLayerTransitionToCheck)) return hdRoutes
  const multilayerCopper = physicalObstacles.filter(
    (obstacle) =>
      obstacle.layers.length > 1 &&
      !obstacle.isNonPlatedHole &&
      !obstacle.isFanoutSourceKeepout,
  )
  const repairedRoutes = [...hdRoutes]
  let repairedAny = false

  for (const [routeIndex, initialRoute] of hdRoutes.entries()) {
    if (!hasLayerTransitionToCheck(initialRoute)) continue
    let route = initialRoute
    const sameNetCopper = multilayerCopper.filter((obstacle) =>
      isObstacleConnectedToRoute(obstacle, route, connMap),
    )
    for (let index = route.route.length - 2; index >= 0; index--) {
      const start = route.route[index]!
      const end = route.route[index + 1]!
      if (!needsCopperWitness(route, start, end)) continue
      const fromLayer = mapZToLayerName(start.z, layerCount)
      const toLayer = mapZToLayerName(end.z, layerCount)
      const copperOnBothLayers = sameNetCopper.filter(
        (obstacle) =>
          obstacle.layers.includes(fromLayer) && obstacle.layers.includes(toLayer),
      )
      if (
        copperOnBothLayers.some(
          (obstacle) =>
            isPointInCopperObstacle(obstacle, start) &&
            isPointInCopperObstacle(obstacle, end),
        )
      ) {
        continue
      }

      const traceWidth = start.traceThickness ?? route.traceThickness
      if (
        !Number.isFinite(traceWidth) ||
        !Number.isFinite(route.viaDiameter) ||
        traceWidth <= 0 ||
        route.viaDiameter <= 0
      ) {
        throw new Error(
          `Invalid trace or via width for "${route.connectionName}"`,
        )
      }
      const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const padContacts = copperOnBothLayers
        .filter(
          (obstacle) =>
            pointToBoxDistance(start, obstacle) <= CONTACT_TOLERANCE &&
            pointToBoxDistance(end, obstacle) <= CONTACT_TOLERANCE,
        )
        .flatMap((copper) =>
          getCopperContactPoints(copper, center, traceWidth / 2).map((point) => ({
            point,
            copper,
          })),
        )
        .sort(
          (a, b) =>
            distance(start, a.point) + distance(a.point, end) -
            distance(start, b.point) - distance(b.point, end),
        )
      const tryTransition = (point: Point, copper?: Obstacle): boolean => {
        const candidate = replaceLayerTransition(route, index, point, copper)
        repairedRoutes[routeIndex] = candidate
        if (!isValid(repairedRoutes)) return false
        route = candidate
        repairedAny = true
        return true
      }

      if (padContacts.some(({ point, copper }) => tryTransition(point, copper))) {
        continue
      }
      if (
        !getViaCandidates(start, end, route.viaDiameter, traceWidth).some(
          (point) => tryTransition(point),
        )
      ) {
        throw new Error(
          `No physical layer transition is available for "${route.connectionName}"`,
        )
      }
    }
    repairedRoutes[routeIndex] = route
  }
  return repairedAny ? repairedRoutes : hdRoutes
}

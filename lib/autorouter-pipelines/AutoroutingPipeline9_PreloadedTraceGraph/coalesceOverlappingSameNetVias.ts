import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ViaLocation = {
  x: number
  y: number
  key: string
  locked: boolean
  hasPadContact: boolean
}

/** Reuses one drill for overlapping same-net vias, preserving every junction. */
export const coalesceOverlappingSameNetVias = ({
  routes,
  connMap,
  viaHoleDiameter,
  srj,
}: {
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  viaHoleDiameter: number
  srj: SimpleRouteJson
}): HighDensityRoute[] => {
  const physicalSrj = {
    ...createSrjWithBoardValidObstacleLayers(srj),
    traces: undefined,
  }
  const netIds = routes.map(
    (route) =>
      connMap.getNetConnectedToId(route.connectionName) ??
      route.rootConnectionName ??
      route.connectionName,
  )
  const locationsByNet = new Map<string, Map<string, ViaLocation>>()
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex]!
    const netId = netIds[routeIndex]!
    let locations = locationsByNet.get(netId)
    if (!locations) {
      locations = new Map()
      locationsByNet.set(netId, locations)
    }
    for (const via of route.vias) {
      const key = `${via.x},${via.y}`
      if (!locations.has(key)) {
        locations.set(key, { ...via, key, locked: false, hasPadContact: false })
      }
    }
  }
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex]!
    const locations = locationsByNet.get(netIds[routeIndex]!)!
    for (let pointIndex = 0; pointIndex < route.route.length; pointIndex++) {
      const point = route.route[pointIndex]!
      if (
        pointIndex !== 0 &&
        pointIndex !== route.route.length - 1 &&
        !point.pcb_port_id &&
        !point.insideJumperPad
      ) continue
      const location = locations.get(`${point.x},${point.y}`)
      if (location) location.locked = true
    }
  }

  const existingPadContacts = getNewViaPadViolations({
    srj: physicalSrj,
    previousRoutes: routes.map((route) => ({ ...route, route: [], vias: [] })),
    routes,
  })
  for (const contact of existingPadContacts) {
    const location = locationsByNet.get(netIds[contact.routeIndex]!)!
      .get(`${contact.center.x},${contact.center.y}`)
    if (location) location.hasPadContact = true
  }
  const initialFixedViolations = new Map(
    getFixedObstacleViolations({ srj: physicalSrj, routes }).map(
      ({ key, severity }) => [key, severity],
    ),
  )
  const movesByNet = new Map<string, Map<string, ViaLocation>>()
  const buildCandidate = (): HighDensityRoute[] => routes.map((route, routeIndex) => {
    const moves = movesByNet.get(netIds[routeIndex]!)
    if (!moves) return route
    const vias = new Map<string, { x: number; y: number }>()
    for (const via of route.vias) {
      const moved = moves.get(`${via.x},${via.y}`) ?? via
      vias.set(`${moved.x},${moved.y}`, { x: moved.x, y: moved.y })
    }
    return {
      ...route,
      route: route.route.map((point) => {
        const moved = moves.get(`${point.x},${point.y}`)
        return moved ? { ...point, x: moved.x, y: moved.y } : point
      }),
      vias: [...vias.values()],
    }
  })
  let output = routes
  for (const [netId, locations] of locationsByNet) {
    const anchors: ViaLocation[] = []
    const moves = new Map<string, ViaLocation>()
    const ordered = [...locations.values()].sort(
      (left, right) =>
        Number(right.locked) - Number(left.locked) ||
        Number(left.hasPadContact) - Number(right.hasPadContact),
    )
    for (const location of ordered) {
      if (!location.locked) {
        for (const anchor of anchors) {
          if (Math.hypot(anchor.x - location.x, anchor.y - location.y) >= viaHoleDiameter) {
            continue
          }
          moves.set(location.key, anchor)
          movesByNet.set(netId, moves)
          const candidate = buildCandidate()
          const hasPhysicalRegression =
            getFixedObstacleViolations({ srj: physicalSrj, routes: candidate }).some(
              ({ key, severity }) =>
                !initialFixedViolations.has(key) ||
                severity > initialFixedViolations.get(key)! + 1e-8,
            ) ||
            getNewViaPadViolations({
              srj: physicalSrj,
              previousRoutes: routes,
              routes: candidate,
            }).length > 0
          if (!hasPhysicalRegression) {
            output = candidate
            break
          }
          moves.delete(location.key)
        }
      }
      if (!moves.has(location.key)) anchors.push(location)
    }
  }
  return output
}

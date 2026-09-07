import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ViaLocation = {
  x: number
  y: number
  key: string
  locked: boolean
}

/** Reuses one drill for overlapping same-net vias, preserving every junction. */
export const coalesceOverlappingSameNetVias = ({
  routes,
  connMap,
  viaHoleDiameter,
}: {
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  viaHoleDiameter: number
}): HighDensityRoute[] => {
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
      if (!locations.has(key)) locations.set(key, { ...via, key, locked: false })
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

  const movesByNet = new Map<string, Map<string, ViaLocation>>()
  for (const [netId, locations] of locationsByNet) {
    const anchors: ViaLocation[] = []
    const moves = new Map<string, ViaLocation>()
    const ordered = [...locations.values()].sort(
      (left, right) => Number(right.locked) - Number(left.locked),
    )
    for (const location of ordered) {
      const anchor = location.locked ? undefined : anchors.find(
        (candidate) =>
          Math.hypot(candidate.x - location.x, candidate.y - location.y) <
          viaHoleDiameter,
      )
      if (anchor) moves.set(location.key, anchor)
      else anchors.push(location)
    }
    if (moves.size > 0) movesByNet.set(netId, moves)
  }
  if (movesByNet.size === 0) return routes

  return routes.map((route, routeIndex) => {
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
}

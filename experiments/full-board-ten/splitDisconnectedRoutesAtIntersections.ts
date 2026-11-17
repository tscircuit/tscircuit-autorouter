import { getSegmentIntersection, type Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type Route = HighDensityIntraNodeRoute
type RoutePoint = Route["route"][number]
type RouteEntry = {
  route: Route
  island: string
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  canSplit: boolean
  cuts: Map<number, Array<{ position: number; point: RoutePoint }>>
}

const hasViaTransition = (
  points: RoutePoint[],
  via: Route["vias"][number],
): boolean => {
  return points.some((point, index) => {
    const next = points[index + 1]
    return Boolean(
      next &&
        point.z !== next.z &&
        Math.hypot(point.x - via.x, point.y - via.y) < 1e-6 &&
        Math.hypot(next.x - via.x, next.y - via.y) < 1e-6,
    )
  })
}

/** Expose existing copper junctions between otherwise disconnected route islands. */
export function splitDisconnectedRoutesAtIntersections(
  routes: Route[],
  getEndpointKey: (connectionName: string, point: Point3) => string,
): Route[] {
  const parents = new Map<string, string>()
  const findIsland = (key: string): string => {
    let root = key
    while (parents.has(root) && parents.get(root) !== root) {
      root = parents.get(root)!
    }
    parents.set(key, root)
    return root
  }
  for (const route of routes) {
    const start = getEndpointKey(route.connectionName, route.route[0]!)
    const end = getEndpointKey(route.connectionName, route.route.at(-1)!)
    parents.set(findIsland(start), findIsland(end))
  }
  const groups = new Map<string, RouteEntry[]>()
  for (const route of routes) {
    const entries = groups.get(route.connectionName) ?? []
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    }
    for (const point of route.route) {
      bounds.minX = Math.min(bounds.minX, point.x)
      bounds.minY = Math.min(bounds.minY, point.y)
      bounds.maxX = Math.max(bounds.maxX, point.x)
      bounds.maxY = Math.max(bounds.maxY, point.y)
    }
    entries.push({
      route,
      island: findIsland(getEndpointKey(route.connectionName, route.route[0]!)),
      bounds,
      // Only split copper whose via ownership remains explicit in the path.
      canSplit:
        !route.jumpers?.length &&
        route.vias.every((via) => hasViaTransition(route.route, via)),
      cuts: new Map(),
    })
    groups.set(route.connectionName, entries)
  }
  const entries = [...groups.values()].flat()
  for (const group of groups.values()) {
    if (new Set(group.map((entry) => entry.island)).size < 2) continue
    for (let a = 0; a < group.length; a++) {
      const first = group[a]!
      for (let b = a + 1; b < group.length; b++) {
        const second = group[b]!
        if (first.island === second.island) continue
        if (!first.canSplit || !second.canSplit) continue
        if (
          first.bounds.maxX < second.bounds.minX ||
          first.bounds.minX > second.bounds.maxX ||
          first.bounds.maxY < second.bounds.minY ||
          first.bounds.minY > second.bounds.maxY
        )
          continue
        for (let i = 0; i < first.route.route.length - 1; i++) {
          const start = first.route.route[i]!
          const end = first.route.route[i + 1]!
          if (
            start.z !== end.z ||
            start.toNextSegmentType ||
            start.insideJumperPad ||
            end.insideJumperPad
          )
            continue
          for (let j = 0; j < second.route.route.length - 1; j++) {
            const otherStart = second.route.route[j]!
            const otherEnd = second.route.route[j + 1]!
            if (
              otherStart.z !== start.z ||
              otherEnd.z !== start.z ||
              otherStart.toNextSegmentType ||
              otherStart.insideJumperPad ||
              otherEnd.insideJumperPad
            )
              continue
            const intersection = getSegmentIntersection(
              start,
              end,
              otherStart,
              otherEnd,
            )
            if (!intersection) continue
            for (const [entry, index] of [
              [first, i],
              [second, j],
            ] as const) {
              const from = entry.route.route[index]!
              const to = entry.route.route[index + 1]!
              const length = Math.hypot(to.x - from.x, to.y - from.y)
              if (length === 0) continue
              const position =
                Math.hypot(intersection.x - from.x, intersection.y - from.y) /
                length
              if (
                (index === 0 && position < 1e-9) ||
                (index === entry.route.route.length - 2 && position > 1 - 1e-9)
              )
                continue
              const cuts = entry.cuts.get(index) ?? []
              if (cuts.some((cut) => Math.abs(cut.position - position) < 1e-9))
                continue
              cuts.push({
                position,
                point: {
                  ...intersection,
                  z: from.z,
                  ...(from.traceThickness !== undefined
                    ? { traceThickness: from.traceThickness }
                    : {}),
                },
              })
              entry.cuts.set(index, cuts)
            }
          }
        }
      }
    }
  }
  const splitByRoute = new Map<Route, Route[]>()
  for (const entry of entries) {
    if (entry.cuts.size === 0) continue
    const original = entry.route
    const pieces: RoutePoint[][] = []
    let points = [original.route[0]!]
    for (let i = 0; i < original.route.length - 1; i++) {
      const cuts = [...(entry.cuts.get(i) ?? [])].sort(
        (a, b) => a.position - b.position,
      )
      for (const cut of cuts) {
        if (cut.position > 1e-9) {
          points.push(
            cut.position > 1 - 1e-9 ? original.route[i + 1]! : cut.point,
          )
        }
        if (points.length > 1) pieces.push(points)
        points = [points.at(-1)!]
      }
      if (points.at(-1) !== original.route[i + 1])
        points.push(original.route[i + 1]!)
    }
    if (points.length > 1) pieces.push(points)
    const { startPcbPortId, endPcbPortId, ...metadata } = original
    const splitRoutes = pieces.map((route, index): Route => ({
      ...metadata,
      route,
      vias: [],
      ...(index === 0 && startPcbPortId ? { startPcbPortId } : {}),
      ...(index === pieces.length - 1 && endPcbPortId ? { endPcbPortId } : {}),
    }))
    for (const via of original.vias) {
      const owners = splitRoutes.filter((piece) =>
        hasViaTransition(piece.route, via),
      )
      if (owners.length === 0) {
        throw new Error(
          "Cannot split a route without preserving its existing via transition",
        )
      }
      for (const owner of owners) owner.vias.push(via)
    }
    splitByRoute.set(original, splitRoutes)
  }
  return routes.flatMap((route) => splitByRoute.get(route) ?? [route])
}

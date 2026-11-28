import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import {
  findClearancePath,
  type ClearancePathSearchStats,
} from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

type RoutePoint = HighDensityRoute["route"][number]
type ViaPair = {
  routeIndex: number
  first: number
  second: number
  distance: number
}

// Keep each replacement local and share a fixed pathfinding budget.
const SEARCH_PADDING = 2
const MAX_SEARCH_CALLS = 700
const MAX_SEARCH_NODES = 350_000
const MAX_NODES_PER_SEARCH = 15_000

function getViaPairs(routes: HighDensityRoute[]): ViaPair[] {
  const pairs: ViaPair[] = []
  for (const [routeIndex, route] of routes.entries()) {
    if (route.jumpers?.length) continue
    let previous: number | undefined
    for (let index = 1; index < route.route.length; index++) {
      const before = route.route[index - 1]!
      const after = route.route[index]!
      if (before.z === after.z) continue
      if (previous !== undefined && route.route[previous - 1]!.z === after.z) {
        const first = route.route[previous]!
        const distance = Math.hypot(first.x - after.x, first.y - after.y)
        if (
          distance <= 2 * SEARCH_PADDING &&
          route.route
            .slice(previous, index)
            .every(
              (point) =>
                !point.pcb_port_id &&
                !point.terminalApproach &&
                !point.toNextSegmentType &&
                !point.insideJumperPad,
            ) &&
          !route.route[previous - 1]!.toNextSegmentType
        ) {
          pairs.push({ routeIndex, first: previous, second: index, distance })
        }
      }
      previous = index
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance)
}

function getPlanarAnchors(
  points: RoutePoint[],
  index: number,
  direction: -1 | 1,
): number[] {
  const anchors = [index]
  let distance = 0
  let nextDistance = SEARCH_PADDING / 4
  for (let cursor = index; distance < SEARCH_PADDING; cursor += direction) {
    const a = points[cursor]!
    const b = points[cursor + direction]
    if (
      !b ||
      b.z !== a.z ||
      a.pcb_port_id ||
      a.terminalApproach ||
      a.toNextSegmentType ||
      b.toNextSegmentType ||
      a.insideJumperPad ||
      b.insideJumperPad
    ) {
      break
    }
    distance += Math.hypot(a.x - b.x, a.y - b.y)
    if (
      distance >= nextDistance ||
      b.pcb_port_id ||
      b.terminalApproach ||
      !points[cursor + 2 * direction]
    ) {
      anchors.push(cursor + direction)
      nextDistance += SEARCH_PADDING / 4
    }
  }
  return anchors
}

/** Replace a two-via detour by a clearance-checked path on the original layer. */
export function removePipeline9PlanarViaPairs({
  srj,
  routes: initialRoutes,
  fixedRoutes,
  targetViaCount,
  viaHoleDiameter,
  isValid,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedRoutes: HighDensityRoute[]
  targetViaCount: number
  viaHoleDiameter: number
  isValid: (routes: HighDensityRoute[]) => boolean
}): HighDensityRoute[] {
  if (
    srj.allowBlindAndBuriedVias ||
    srj.differentialPairs?.length ||
    srj.buses?.length
  ) {
    return initialRoutes
  }
  const board = srj.bounds
  const outline = srj.outline ?? [
    { x: board.minX, y: board.minY },
    { x: board.maxX, y: board.minY },
    { x: board.maxX, y: board.maxY },
    { x: board.minX, y: board.maxY },
  ]
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    return {
      a,
      b,
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxY: Math.max(a.y, b.y),
    }
  })
  const traceClearance =
    srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance
  const viaClearance =
    srj.minPadEdgeToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance
  // Fixed traces are already normalized to high-density copper geometry.
  const searchSrj = { ...srj, traces: undefined }
  let routes = initialRoutes
  let viaCount = routes.reduce((count, route) => count + route.vias.length, 0)
  let callsLeft = MAX_SEARCH_CALLS
  let nodesLeft = MAX_SEARCH_NODES
  const changedRoutes = new Set<number>()
  for (const { routeIndex, first, second } of getViaPairs(routes)) {
    if (changedRoutes.has(routeIndex)) continue
    if (viaCount <= targetViaCount) break
    const route = routes[routeIndex]!
    const copper = fixedRoutes.length ? [...routes, ...fixedRoutes] : routes
    const existingPoints = route.route
    const firstVia = existingPoints[first]!
    const secondVia = existingPoints[second]!
    const replacedVias = [firstVia, secondVia]
    const vias = route.vias.filter(
      (via) =>
        !replacedVias.some((point) => point.x === via.x && point.y === via.y),
    )
    if (route.vias.length - vias.length !== 2) continue
    const starts = getPlanarAnchors(existingPoints, first - 1, -1)
    const ends = getPlanarAnchors(existingPoints, second, 1)
    search: for (const startIndex of starts) {
      const start = existingPoints[startIndex]!
      if (!isPointInOrOnPolygon(start, outline)) continue
      for (const endIndex of ends) {
        if (callsLeft <= 0 || nodesLeft <= 0) return routes
        const end = existingPoints[endIndex]!
        if (!isPointInOrOnPolygon(end, outline)) continue
        const traceThickness = existingPoints
          .slice(startIndex, endIndex + 1)
          .reduce(
            (width, point) => Math.max(width, point.traceThickness ?? 0),
            route.traceThickness,
          )
        const clearance =
          (srj.minBoardEdgeClearance ?? 0) + traceThickness / 2 + 1e-8
        const edgeCost = (a: RoutePoint, b: RoutePoint): number => {
          const minX = Math.min(a.x, b.x) - clearance
          const maxX = Math.max(a.x, b.x) + clearance
          const minY = Math.min(a.y, b.y) - clearance
          const maxY = Math.max(a.y, b.y) + clearance
          for (const edge of edges) {
            if (
              edge.maxX < minX ||
              edge.minX > maxX ||
              edge.maxY < minY ||
              edge.minY > maxY
            ) {
              continue
            }
            if (segmentToSegmentMinDistance(a, b, edge.a, edge.b) < clearance) {
              return Infinity
            }
          }
          return 0
        }
        const stats: ClearancePathSearchStats = {
          nodesPopped: 0,
          completionReason: "no-path",
        }
        callsLeft--
        const minX = Math.min(start.x, end.x) - SEARCH_PADDING
        const minY = Math.min(start.y, end.y) - SEARCH_PADDING
        const maxX = Math.max(start.x, end.x) + SEARCH_PADDING
        const maxY = Math.max(start.y, end.y) + SEARCH_PADDING
        const path = findClearancePath({
          srj: searchSrj,
          routes: copper,
          routeIndex,
          start,
          end,
          bounds: {
            minX: Math.max(board.minX, minX),
            minY: Math.max(board.minY, minY),
            maxX: Math.min(board.maxX, maxX),
            maxY: Math.min(board.maxY, maxY),
          },
          traceThickness,
          traceClearance,
          viaClearance,
          viaHoleDiameter,
          gridSize: 0.1,
          maxNodes: Math.min(nodesLeft, MAX_NODES_PER_SEARCH),
          allowLayerChanges: false,
          heuristicWeight: 1.5,
          getAdditionalEdgeCost: edgeCost,
          stats,
        })
        nodesLeft -= stats.nodesPopped
        if (!path) continue
        const points = [
          ...existingPoints.slice(0, startIndex),
          ...path,
          ...existingPoints.slice(endIndex + 1),
        ]
        if (
          points.some(
            (point, index) =>
              index > 0 &&
              points[index - 1]!.z !== point.z &&
              replacedVias.some(
                (via) => via.x === point.x && via.y === point.y,
              ),
          )
        ) {
          continue
        }
        const candidate = [...routes]
        candidate[routeIndex] = {
          ...route,
          route: points,
          vias,
        }
        if (!isValid(candidate)) continue
        routes = candidate
        viaCount -= 2
        changedRoutes.add(routeIndex)
        break search
      }
    }
  }
  return routes
}

import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

type StraightCellParams = {
  node: NodeWithPortPoints
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  layerCount: number
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
}

type StraightCellConstruction =
  | { applicable: false }
  | { applicable: true; routes: HighDensityIntraNodeRoute[] }

/**
 * A parametric constructor for independent straight chords of a convex cell.
 * The dimensions and endpoints are free parameters; there is no stored route
 * or search. Applicability proves copper clearance, rather than merely that
 * the zero-width chords do not intersect. Unsupported cells stay in the
 * ordinary solver, before any constructor has been attempted.
 */
export const constructPipeline9StraightCell = ({
  node,
  obstacles,
  boardGeometry,
  layerCount,
  traceWidth,
  viaDiameter,
  obstacleMargin,
}: StraightCellParams): StraightCellConstruction => {
  const groups = new Map<string, PortPoint[]>()
  for (const port of node.portPoints) {
    const ports = groups.get(port.connectionName) ?? []
    ports.push(port)
    groups.set(port.connectionName, ports)
  }
  // A branching connection needs an electrical tree, not independent chords.
  if ([...groups.values()].some((ports) => ports.length !== 2)) {
    return { applicable: false }
  }

  const bounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
  if (
    node.portPoints.some(
      (port) =>
        !Number.isInteger(port.z) ||
        port.z < 0 ||
        port.z >= layerCount ||
        (node.availableZ !== undefined && !node.availableZ.includes(port.z)) ||
        port.x < bounds.minX ||
        port.x > bounds.maxX ||
        port.y < bounds.minY ||
        port.y > bounds.maxY,
    )
  ) {
    return { applicable: false }
  }

  const routes: HighDensityIntraNodeRoute[] = []
  const radius = traceWidth / 2
  const clearance = radius + obstacleMargin + 1e-6
  const boardPolygon = boardGeometry
    ? boardGeometry.outline && boardGeometry.outline.length >= 3
      ? boardGeometry.outline
      : [
          { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.minY },
          { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.minY },
          { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.maxY },
          { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.maxY },
        ]
    : undefined
  const boardMargin = radius + (boardGeometry?.minBoardEdgeClearance ?? 0.15)
  for (const [connectionName, ports] of groups) {
    const [start, end] = ports as [PortPoint, PortPoint]
    if (start.z !== end.z) return { applicable: false }
    if (
      boardPolygon &&
      (!isPointInOrOnPolygon(start, boardPolygon) ||
        !isPointInOrOnPolygon(end, boardPolygon) ||
        boardPolygon.some(
          (point, index) =>
            minimumDistanceBetweenSegments(
              start,
              end,
              point,
              boardPolygon[(index + 1) % boardPolygon.length]!,
            ) < boardMargin + 1e-6,
        ))
    ) {
      return { applicable: false }
    }
    for (const obstacle of obstacles) {
      const layers =
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
      if (!layers.includes(start.z)) continue
      // The disk encloses rects at every rotation and circular pads alike.
      // Even connected copper is excluded, so no ownership exemption can
      // accidentally legalize a foreign pad or a non-plated hole.
      const obstacleRadius = Math.hypot(obstacle.width, obstacle.height) / 2
      if (
        pointToSegmentDistance(obstacle.center, start, end) <
        obstacleRadius + clearance
      ) {
        return { applicable: false }
      }
    }
    const root = start.rootConnectionName ?? connectionName
    for (const route of routes) {
      if (
        route.route[0]!.z !== start.z ||
        (route.rootConnectionName ?? route.connectionName) === root
      ) {
        continue
      }
      if (
        minimumDistanceBetweenSegments(
          start,
          end,
          route.route[0]!,
          route.route[1]!,
        ) < traceWidth + obstacleMargin + 1e-6
      ) {
        return { applicable: false }
      }
    }
    routes.push({
      connectionName,
      rootConnectionName: root,
      regionId: node.capacityMeshNodeId,
      traceThickness: traceWidth,
      viaDiameter,
      route: [
        { x: start.x, y: start.y, z: start.z },
        { x: end.x, y: end.y, z: end.z },
      ],
      vias: [],
    })
  }
  return { applicable: true, routes }
}

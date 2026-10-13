import type { SimpleRouteJson } from "lib/types"
import { getConvexHull } from "./geometry"
import {
  getAvailableZFromMask,
  getObstacleLayerMask,
  polyArea,
  type ConvexRegionsComputeResult,
  type Point,
  type PolyHyperGraphObstacleRegion,
} from "pcb-poly-hyper-graph"

type HalfPlane = { x: number; y: number; limit: number }
type Cell = { polygon: Point[]; availableZ: number[] }
export type OctagonalRegionsResult = ConvexRegionsComputeResult & {
  availableZ: number[][]
  obstacleRegions: PolyHyperGraphObstacleRegion[]
}

const EPSILON = 1e-9
const NORMALS: Point[] = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
]

function clipPolygon(polygon: Point[], plane: HalfPlane): Point[] {
  const output: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const da = a.x * plane.x + a.y * plane.y - plane.limit
    const db = b.x * plane.x + b.y * plane.y - plane.limit
    if (da <= EPSILON) output.push(a)
    if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
      const t = da / (da - db)
      output.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    }
  }
  const corners = output.filter((point, i) => {
    const prev = output[(i + output.length - 1) % output.length]!
    const next = output[(i + 1) % output.length]!
    return Math.abs((point.x - prev.x) * (next.y - point.y) -
      (point.y - prev.y) * (next.x - point.x)) > EPSILON ** 2
  })
  return corners.length >= 3 && polyArea(corners) > EPSILON ** 2 ? corners : []
}

// Splitting an edge at a T junction makes both neighbors expose identical
// segments to the hypergraph. Collinear seam vertices do not add geometric sides.
function splitSharedEdges(regions: Point[][]): Point[][] {
  const lines = new Map<string, Map<string, Point>>()
  for (const polygon of regions) {
    for (const point of polygon) {
      for (const normal of NORMALS.slice(0, 4)) {
        const key = `${normal.x},${normal.y}:${Math.round(
          (point.x * normal.x + point.y * normal.y) * 1e8,
        )}`
        let points = lines.get(key)
        if (!points) lines.set(key, points = new Map())
        points.set(`${Math.round(point.x * 1e8)},${Math.round(point.y * 1e8)}`, point)
      }
    }
  }
  return regions.map((polygon) => polygon.flatMap((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const normal = Math.abs(dx) < EPSILON ? NORMALS[0]! :
      Math.abs(dy) < EPSILON ? NORMALS[2]! :
      dx * dy < 0 ? NORMALS[1]! : NORMALS[3]!
    const key = `${normal.x},${normal.y}:${Math.round(
      (a.x * normal.x + a.y * normal.y) * 1e8,
    )}`
    const points = lines.get(key)
    if (!points) throw new Error("Octagonal region edge has no seam vertices")
    const lengthSq = dx * dx + dy * dy
    const interior = [...points.values()].map((point) => ({
      point, t: ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq,
    })).filter(({ point, t }) => t > EPSILON && t < 1 - EPSILON &&
      Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) < EPSILON)
      .sort((first, second) => first.t - second.t)
    return [a, ...interior.map(({ point }) => point)]
  }))
}

function mergeOctagonalCells(cells: Cell[]): Cell[] {
  let changed = true
  while (changed) {
    changed = false
    const polygons = splitSharedEdges(cells.map((cell) => cell.polygon))
    const edges = new Map<string, number[]>()
    for (const [i, polygon] of polygons.entries()) {
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j]!
        const b = polygon[(j + 1) % polygon.length]!
        const keys = [a, b].map((point) =>
          `${Math.round(point.x * 1e8)},${Math.round(point.y * 1e8)}`).sort()
        const key = keys.join("|")
        const neighbors = edges.get(key)
        if (neighbors) neighbors.push(i)
        else edges.set(key, [i])
      }
    }
    const consumed = new Set<number>()
    const merged: Cell[] = []
    for (const neighbors of edges.values()) {
      if (neighbors.length !== 2) continue
      const [i, j] = neighbors as [number, number]
      if (consumed.has(i) || consumed.has(j)) continue
      const first = cells[i]!
      const second = cells[j]!
      if (first.availableZ.join(",") !== second.availableZ.join(",")) continue
      const hull = getConvexHull([...first.polygon, ...second.polygon])
      const area = polyArea(first.polygon) + polyArea(second.polygon)
      if (hull.length > 8 || Math.abs(polyArea(hull) - area) > EPSILON * Math.max(1, area)) continue
      merged.push({ polygon: hull, availableZ: first.availableZ })
      consumed.add(i)
      consumed.add(j)
      changed = true
    }
    cells = [...cells.filter((_, i) => !consumed.has(i)), ...merged]
  }
  return cells
}

/** Subtract circumscribed octagons using the eight octilinear half planes.
 * Cells partition XY space; each retains exactly its unblocked routing layers.
 */
export function computeOctagonalRegions(
  srj: SimpleRouteJson,
  clearance: number,
): OctagonalRegionsResult {
  const { minX, minY, maxX, maxY } = srj.bounds
  if (!Number.isFinite(clearance) || clearance < 0 ||
    ![minX, minY, maxX, maxY].every(Number.isFinite) ||
    minX >= maxX || minY >= maxY ||
    !Number.isInteger(srj.layerCount) || srj.layerCount < 1 || srj.layerCount > 30) {
    throw new Error("Octagonal regions require valid bounds, clearance and 1–30 layers")
  }
  const board: Point[] = [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ]
  let cells: Cell[] = [{ polygon: board, availableZ: Array.from(
    { length: srj.layerCount }, (_, z) => z,
  ) }]
  const obstacleRegions: PolyHyperGraphObstacleRegion[] = []
  for (const [index, obstacle] of srj.obstacles.entries()) {
    const shape = (obstacle as { type: string }).type
    if ((shape !== "rect" && shape !== "oval") ||
      ![obstacle.width, obstacle.height, obstacle.center.x, obstacle.center.y,
        obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0) {
      throw new Error(`Invalid octagonal obstacle ${obstacle.obstacleId ?? index}`)
    }
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const mask = getObstacleLayerMask({ ...obstacle,
      zLayers: obstacle.__zLayers ?? obstacle.zLayers,
      ccwRotation: angle,
    }, srj.layerCount)
    const blockedZ = getAvailableZFromMask(mask, srj.layerCount)
    if (blockedZ.length === 0) continue
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const planes = NORMALS.map(({ x, y }): HalfPlane => {
      const rx = obstacle.width / 2 * (x * cos + y * sin)
      const ry = obstacle.height / 2 * (-x * sin + y * cos)
      const support = shape === "oval" || obstacle.shape === "circle"
        ? Math.hypot(rx, ry) : Math.abs(rx) + Math.abs(ry)
      return { x, y, limit: obstacle.center.x * x + obstacle.center.y * y +
        support + clearance * Math.hypot(x, y) }
    })
    const obstaclePolygon = planes.reduce(clipPolygon, board)
    if (obstaclePolygon.length === 0) continue
    if (obstacle.connectedTo.length > 0) {
      obstacleRegions.push({ regionId: `connected-obstacle-${index}`,
        polygon: obstaclePolygon, availableZ: blockedZ, connectedTo: obstacle.connectedTo })
    }
    cells = cells.flatMap((cell): Cell[] => {
      const remainingZ = cell.availableZ.filter((z) => !blockedZ.includes(z))
      if (remainingZ.length === cell.availableZ.length) return [cell]
      const intersection = planes.reduce(clipPolygon, cell.polygon)
      if (intersection.length === 0) return [cell]
      const pieces: Cell[] = []
      let inside = cell.polygon
      for (const plane of planes) {
        const outside = clipPolygon(inside, {
          x: -plane.x, y: -plane.y, limit: -plane.limit,
        })
        if (outside.length > 0) pieces.push({ polygon: outside, availableZ: cell.availableZ })
        inside = clipPolygon(inside, plane)
        if (inside.length === 0) break
      }
      if (remainingZ.length > 0) pieces.push({ polygon: intersection, availableZ: remainingZ })
      return pieces
    })
  }
  cells = mergeOctagonalCells(cells)
  const regions = splitSharedEdges(cells.map((cell) => cell.polygon))
  return { pts: regions.flat(), validTris: [], regions, hulls: regions,
    depths: regions.map(() => 0), availableZ: cells.map((cell) => cell.availableZ),
    obstacleRegions }
}

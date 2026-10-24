import { BooleanOperations, Polygon as FlattenPolygon, point as flattenPoint } from "@flatten-js/core"
import Flatbush from "flatbush"
import orientation from "robust-orientation"
import { constrainedDelaunay } from "pcb-poly-hyper-graph"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import type { CorridorPathInput } from "./createVisibilityCorridorSearch"
import type { ClearancePathSearchStats } from "./findClearancePath"
import { REGION_EPSILON } from "./repairRegionGeometry"

type XY = { x: number; y: number }
export type MeshBarrier = Bounds & {
  minZ: number; maxZ: number; a: RepairRoutePoint; b: RepairRoutePoint; radius: number
  viaOnly?: boolean; rect?: { width: number; height: number; rotation: number }
}
export type CorridorMeshStats = ClearancePathSearchStats & { [key: string]: number | string }
export type MeshCorridorPathInput = CorridorPathInput & {
  /** Explicit experimental construction caps; capped geometry is unknown. */
  maxMeshPoints?: number
  maxMeshConstructionWork?: number
}
export type MeshCell = { vertices: [number, number, number]; nodes: number[]; z: number; bounds: Bounds }
export type CorridorMesh = {
  sites: RepairRoutePoint[]; cells: MeshCell[]; memberships: number[][]
  startId: number; endId: number
  addProjection(x: number, y: number, z: number): number
}
export class CorridorMeshLimit extends Error {}

type Ring = { points: XY[]; bounds: Bounds }
export function canonicalizeMeshRing(points: XY[], bounds: Bounds): XY[] {
  const snapped = points.map((p): XY => ({
    x: p.x === bounds.minX || p.x === bounds.maxX ? p.x : Math.round(p.x / REGION_EPSILON) * REGION_EPSILON,
    y: p.y === bounds.minY || p.y === bounds.maxY ? p.y : Math.round(p.y / REGION_EPSILON) * REGION_EPSILON,
  })).filter((p, i, all): boolean => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y)
  if (snapped.length > 1 && snapped[0]!.x === snapped.at(-1)!.x && snapped[0]!.y === snapped.at(-1)!.y) snapped.pop()
  return snapped.filter((p, i, all): boolean => {
    const previous = all[(i + all.length - 1) % all.length]!, next = all[(i + 1) % all.length]!
    return orientation([previous.x, previous.y], [p.x, p.y], [next.x, next.y]) !== 0
  })
}

function boundsOf(points: XY[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return { minX, maxX, minY, maxY }
}

export function meshTriangleContains(p: XY, a: XY, b: XY, c: XY): boolean {
  const first = orientation([a.x, a.y], [b.x, b.y], [p.x, p.y])
  const second = orientation([b.x, b.y], [c.x, c.y], [p.x, p.y])
  const third = orientation([c.x, c.y], [a.x, a.y], [p.x, p.y])
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0)
}

/** Conservative convex support polygon: exact physical predicates remain authoritative. */
export function meshBarrierRing(barrier: MeshBarrier, padding: number): XY[] {
  const points: XY[] = []
  const outward = Number.EPSILON * 64 * Math.max(1, Math.abs(barrier.a.x), Math.abs(barrier.a.y), Math.abs(barrier.b.x), Math.abs(barrier.b.y), barrier.radius + padding)
  if (barrier.rect) {
    const { width, height, rotation } = barrier.rect
    const cos = Math.cos(rotation), sin = Math.sin(rotation)
    // Local square dilation contains a circular offset, including rotated pads.
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const dx = x! * (width / 2 + padding + outward), dy = y! * (height / 2 + padding + outward)
      points.push({ x: barrier.a.x + dx * cos - dy * sin, y: barrier.a.y + dx * sin + dy * cos })
    }
    return points
  }
  const radius = (barrier.radius + padding + outward) / Math.cos(Math.PI / 32)
  for (const center of [barrier.a, barrier.b]) for (let i = 0; i < 32; i++) {
    const angle = (i + 0.5) * 2 * Math.PI / 32
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  }
  points.sort((a, b): number => a.x - b.x || a.y - b.y)
  const unique = points.filter((p, i): boolean => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
  const hull: XY[] = []
  for (const p of unique) {
    while (hull.length >= 2 && orientation([hull.at(-2)!.x, hull.at(-2)!.y], [hull.at(-1)!.x, hull.at(-1)!.y], [p.x, p.y]) >= 0) hull.pop()
    hull.push(p)
  }
  const lower = hull.length
  for (let i = unique.length - 2; i >= 0; i--) {
    const p = unique[i]!
    while (hull.length > lower && orientation([hull.at(-2)!.x, hull.at(-2)!.y], [hull.at(-1)!.x, hull.at(-1)!.y], [p.x, p.y]) >= 0) hull.pop()
    hull.push(p)
  }
  hull.pop()
  return hull
}

function clipRing(points: XY[], bounds: Bounds): XY[] {
  let ring = points
  for (const [axis, boundary, minimum] of [["x", bounds.minX, true], ["x", bounds.maxX, false], ["y", bounds.minY, true], ["y", bounds.maxY, false]] as const) {
    const clipped: XY[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!
      const insideA = minimum ? a[axis] >= boundary : a[axis] <= boundary
      const insideB = minimum ? b[axis] >= boundary : b[axis] <= boundary
      if (insideA) clipped.push(a)
      if (insideA !== insideB) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis])
        const crossing = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        crossing[axis] = boundary
        clipped.push(crossing)
      }
    }
    ring = clipped.filter((p, i): boolean => i === 0 || p.x !== clipped[i - 1]!.x || p.y !== clipped[i - 1]!.y)
  }
  if (ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y) ring.pop()
  return ring
}

/**
 * Per-layer polygon union creates noncrossing PSLGs, preserving hole rings and
 * their native orientation. No dependency union fallback or jitter is used.
 * CDT includes interiors too: lazily verified physical cells, not polygon
 * winding alone, decide usable copper space on each actual layer.
 */
export function buildConstrainedCorridorMesh(input: MeshCorridorPathInput, barriers: MeshBarrier[], stats: CorridorMeshStats): CorridorMesh {
  const bounds = input.bounds
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) throw new Error("Mesh corridor requires nondegenerate finite bounds")
  const layers = input.allowLayerChanges === false ? [input.start.z] : Array.from({ length: input.srj.layerCount }, (_, z): number => z)
  const maxPoints = input.maxMeshPoints ?? 50_000
  const maxWork = input.maxMeshConstructionWork ?? 5_000_000
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 4 || !Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error("Invalid explicit mesh construction allowance")
  const names = ["meshConstructionWork", "meshPrimitiveRings", "meshRingVertices", "meshSnapCoordinates", "meshUnionPairs", "meshUnionCalls", "meshUnionInputVertices", "meshUnionOutputVertices", "meshUnionFaces", "meshConstraintPointTests", "meshConstraints", "meshCdtCalls", "meshCdtInputPoints", "meshCdtTriangles", "meshConstraintVerification", "meshSites", "meshCells", "meshMemberships", "meshProjectionQueries", "meshProjectionCandidates", "meshPointProposals"]
  for (const name of names) stats[name] = 0
  const charge = (count = 1): void => {
    stats.meshConstructionWork = (stats.meshConstructionWork as number) + count
    if ((stats.meshConstructionWork as number) > maxWork) throw new CorridorMeshLimit("Explicit mesh construction work limit")
  }
  const padding = input.traceThickness / 2 + Math.max(input.traceClearance, input.srj.defaultObstacleMargin ?? 0,
    input.srj.minTraceToPadEdgeClearance ?? 0, input.srj.minTraceToHoleEdgeClearance ?? 0) + 1e-6
  if (!Number.isFinite(padding) || padding <= 0) throw new Error("Invalid mesh physical support padding")
  const coordinateMagnitude = Math.max(1, Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY))
  const snapBound = Math.SQRT2 * (REGION_EPSILON / 2 + Number.EPSILON * 8 * coordinateMagnitude)
  if (!(snapBound < 1e-6)) throw new Error("Mesh coordinate precision exceeds outward support padding")
  const ringsByLayer = new Map<number, XY[][]>()
  for (const z of layers) {
    const rings: Ring[] = []
    for (const barrier of barriers) {
      charge()
      if (barrier.viaOnly || barrier.minZ > z || barrier.maxZ < z || barrier.maxX + padding < bounds.minX || barrier.minX - padding > bounds.maxX || barrier.maxY + padding < bounds.minY || barrier.minY - padding > bounds.maxY) continue
      const rawRing = clipRing(meshBarrierRing(barrier, padding), bounds)
      const ring = canonicalizeMeshRing(rawRing, bounds)
      stats.meshSnapCoordinates = (stats.meshSnapCoordinates as number) + rawRing.length * 2
      charge(ring.length)
      if (ring.length < 3) continue
      stats.meshPrimitiveRings = (stats.meshPrimitiveRings as number) + 1
      stats.meshRingVertices = (stats.meshRingVertices as number) + ring.length
      rings.push({ points: ring, bounds: boundsOf(ring) })
    }
    const merged: XY[][] = []
    if (rings.length) {
      const index = new Flatbush(rings.length)
      for (const ring of rings) index.add(ring.bounds.minX, ring.bounds.minY, ring.bounds.maxX, ring.bounds.maxY)
      index.finish()
      const parent = rings.map((_, i): number => i)
      const root = (id: number): number => {
        while (parent[id] !== id) { parent[id] = parent[parent[id]!]!; id = parent[id]! }
        return id
      }
      for (let i = 0; i < rings.length; i++) {
        const box = rings[i]!.bounds
        for (const j of index.search(box.minX, box.minY, box.maxX, box.maxY)) {
          charge(); stats.meshUnionPairs = (stats.meshUnionPairs as number) + 1
          if (j > i) parent[root(j)] = root(i)
        }
      }
      const groups = new Map<number, Ring[]>()
      for (let i = 0; i < rings.length; i++) { const id = root(i), group = groups.get(id); if (group) group.push(rings[i]!); else groups.set(id, [rings[i]!]) }
      for (const group of groups.values()) {
        let polygon = new FlattenPolygon(group[0]!.points.map((p) => flattenPoint(p.x, p.y)))
        for (let i = 1; i < group.length; i++) {
          const inputVertices = [...polygon.faces].reduce((sum, face): number => sum + face.vertices.length, 0) + group[i]!.points.length
          charge(inputVertices); stats.meshUnionInputVertices = (stats.meshUnionInputVertices as number) + inputVertices
          stats.meshUnionCalls = (stats.meshUnionCalls as number) + 1
          try {
            polygon = BooleanOperations.unify(polygon, new FlattenPolygon(group[i]!.points.map((p) => flattenPoint(p.x, p.y))))
          } catch (error) {
            const context = { z, left: [...polygon.faces].map((face) => face.vertices.map((p: XY): XY => ({ x: p.x, y: p.y }))), right: group[i]!.points }
            throw new Error(`Constrained mesh union failed: ${JSON.stringify(context)}`, { cause: error })
          }
          if (polygon.faces.size === 0) throw new Error("Mesh polygon union unexpectedly lost nonempty geometry")
        }
        for (const face of polygon.faces) {
          const ring = clipRing(face.vertices.map((p: XY): XY => ({ x: p.x, y: p.y })), bounds)
          charge(ring.length)
          if (ring.length < 3) throw new Error("Mesh union returned a degenerate face")
          merged.push(ring); stats.meshUnionFaces = (stats.meshUnionFaces as number) + 1
          stats.meshUnionOutputVertices = (stats.meshUnionOutputVertices as number) + ring.length
        }
      }
    }
    ringsByLayer.set(z, merged)
  }
  const points: XY[] = [], pointIds = new Map<string, number>()
  const addPoint = (p: XY): number => {
    charge(); stats.meshPointProposals = (stats.meshPointProposals as number) + 1
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Mesh point is nonfinite")
    if (p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY) return -1
    const key = `${p.x}:${p.y}`, old = pointIds.get(key)
    if (old !== undefined) return old
    if (points.length >= maxPoints) throw new CorridorMeshLimit("Explicit mesh point limit")
    pointIds.set(key, points.length); points.push({ x: p.x, y: p.y }); return points.length - 1
  }
  addPoint(input.start); addPoint(input.end)
  const crop = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]
  for (const p of crop) addPoint(p)
  for (const rings of ringsByLayer.values()) for (const ring of rings) for (const p of ring) addPoint(p)
  for (const p of input.existingPath ?? []) addPoint(p)
  for (const route of input.guideRoutes ?? []) {
    for (const p of route.route) addPoint(p)
    // Movable copper is guidance only. Its offset box corners propose local
    // alternatives without turning its temporary footprint into a hard hole.
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!, b = route.route[i]!
      const radius = (a.z === b.z ? route.traceThickness : route.viaDiameter) / 2 + padding
      for (const x of [Math.min(a.x, b.x) - radius, Math.max(a.x, b.x) + radius])
        for (const y of [Math.min(a.y, b.y) - radius, Math.max(a.y, b.y) + radius]) addPoint({ x, y })
    }
  }
  const pointIndex = new Flatbush(points.length)
  for (const p of points) pointIndex.add(p.x, p.y, p.x, p.y)
  pointIndex.finish()
  const sites: RepairRoutePoint[] = [], memberships: number[][] = [], cells: MeshCell[] = []
  const siteIds = new Map<string, number>(), cellIndices = new Map<number, { index: Flatbush; ids: number[] }>()
  const addSite = (p: XY, z: number): number => {
    const key = `${p.x}:${p.y}:${z}`, old = siteIds.get(key)
    if (old !== undefined) return old
    charge()
    if (sites.length >= maxPoints * layers.length * 8) throw new CorridorMeshLimit("Explicit mesh site limit")
    const id = sites.length
    sites.push({ x: p.x, y: p.y, z, traceThickness: input.traceThickness }); memberships.push([]); siteIds.set(key, id); return id
  }
  const startId = addSite(input.start, input.start.z), endId = addSite(input.end, input.end.z)
  for (const z of layers) {
    const edges: [number, number][] = [], edgeKeys = new Set<string>()
    for (const ring of [crop, ...ringsByLayer.get(z)!]) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!
      const splits: number[] = []
      for (const id of pointIndex.search(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
        charge(); stats.meshConstraintPointTests = (stats.meshConstraintPointTests as number) + 1
        const p = points[id]!
        if (orientation([a.x, a.y], [b.x, b.y], [p.x, p.y]) === 0) splits.push(id)
      }
      const xAxis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
      splits.sort((u, v): number => xAxis ? points[u]!.x - points[v]!.x : points[u]!.y - points[v]!.y)
      for (let j = 1; j < splits.length; j++) {
        const u = splits[j - 1]!, v = splits[j]!, key = `${Math.min(u, v)}:${Math.max(u, v)}`
        if (u !== v && !edgeKeys.has(key)) { edgeKeys.add(key); edges.push([u, v]) }
      }
    }
    stats.meshConstraints = (stats.meshConstraints as number) + edges.length
    stats.meshCdtCalls = (stats.meshCdtCalls as number) + 1
    stats.meshCdtInputPoints = (stats.meshCdtInputPoints as number) + points.length
    const triangles = constrainedDelaunay(points, edges, { includeConstraintInteriors: true })
    charge(triangles.length); stats.meshCdtTriangles = (stats.meshCdtTriangles as number) + triangles.length
    const triangleEdges = new Set<string>(), layerCells: number[] = []
    for (const triangle of triangles) {
      const ps = triangle.map((id) => points[id]!)
      if (ps.some((p) => !p) || orientation([ps[0]!.x, ps[0]!.y], [ps[1]!.x, ps[1]!.y], [ps[2]!.x, ps[2]!.y]) === 0) throw new Error("CDT returned invalid triangle")
      const nodes = triangle.map((id): number => addSite(points[id]!, z))
      for (let i = 0; i < 3; i++) {
        const a = triangle[i]!, b = triangle[(i + 1) % 3]!
        triangleEdges.add(`${Math.min(a, b)}:${Math.max(a, b)}`)
        nodes.push(addSite({ x: (points[a]!.x + points[b]!.x) / 2, y: (points[a]!.y + points[b]!.y) / 2 }, z))
      }
      nodes.push(addSite({ x: (ps[0]!.x + ps[1]!.x + ps[2]!.x) / 3, y: (ps[0]!.y + ps[1]!.y + ps[2]!.y) / 3 }, z))
      const id = cells.length
      cells.push({ vertices: [nodes[0]!, nodes[1]!, nodes[2]!], nodes: [...new Set(nodes)], z, bounds: boundsOf(ps) }); layerCells.push(id)
      for (const node of cells[id]!.nodes) { memberships[node]!.push(id); stats.meshMemberships = (stats.meshMemberships as number) + 1 }
    }
    for (const [a, b] of edges) {
      charge(); stats.meshConstraintVerification = (stats.meshConstraintVerification as number) + 1
      if (!triangleEdges.has(`${Math.min(a, b)}:${Math.max(a, b)}`)) throw new Error("CDT omitted a requested obstacle boundary constraint")
    }
    if (!layerCells.length) throw new Error("CDT returned no cells for nondegenerate crop")
    const index = new Flatbush(layerCells.length)
    for (const id of layerCells) { const box = cells[id]!.bounds; index.add(box.minX, box.minY, box.maxX, box.maxY) }
    index.finish(); cellIndices.set(z, { index, ids: layerCells })
  }
  stats.meshSites = sites.length; stats.meshCells = cells.length
  const addProjection = (x: number, y: number, z: number): number => {
    const key = `${x}:${y}:${z}`, known = siteIds.get(key)
    if (known !== undefined) return known
    const layer = cellIndices.get(z)
    if (!layer) throw new Error("Via projection requests an absent mesh layer")
    stats.meshProjectionQueries = (stats.meshProjectionQueries as number) + 1
    const id = addSite({ x, y }, z)
    for (const candidate of layer.index.search(x, y, x, y)) {
      stats.meshProjectionCandidates = (stats.meshProjectionCandidates as number) + 1
      const cell = cells[layer.ids[candidate]!]!, a = sites[cell.vertices[0]]!, b = sites[cell.vertices[1]]!, c = sites[cell.vertices[2]]!
      if (meshTriangleContains({ x, y }, a, b, c)) {
        memberships[id]!.push(layer.ids[candidate]!)
        stats.meshMemberships = (stats.meshMemberships as number) + 1
      }
    }
    // Directed projection attachment avoids turning a coarse cell containing
    // many other-layer portal samples back into a dense all-pairs clique.
    stats.meshSites = sites.length
    return id
  }
  return { sites, cells, memberships, startId, endId, addProjection }
}

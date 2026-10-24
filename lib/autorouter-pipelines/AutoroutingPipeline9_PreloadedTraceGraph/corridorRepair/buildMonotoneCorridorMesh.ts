import Flatbush from "flatbush"
import orientation from "robust-orientation"
import cdt2d from "cdt2d"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { REGION_EPSILON } from "./repairRegionGeometry"
import {
  canonicalizeMeshRing, meshBarrierRing, meshTriangleContains, CorridorMeshLimit,
  type CorridorMeshStats, type MeshBarrier, type MeshCorridorPathInput,
  type CorridorMesh, type MeshCell,
} from "./buildConstrainedCorridorMesh"

type XY = { x: number; y: number }

function boundsOf(points: XY[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return { minX, maxX, minY, maxY }
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
 * Proposal-only monotone triangulation of raw support samples. No polygon union,
 * obstacle constraints or Delaunay edge refinement is performed. One XY mesh is
 * extruded onto all allowed layers; native whole-triangle/edge/via predicates
 * remain authoritative. Mixed cells can discard real narrow corridors, so mesh
 * exhaustion is only failure of this finite search policy.
 *
 * cdt2d 1.0.0 is already in the common pinned dependency tree. Its explicit
 * delaunay:false/interior:true/exterior:true branch returns the initial sweep
 * cells without indexing, exact-in-sphere refinement or interior filtering.
 */
export function buildMonotoneCorridorMesh(input: MeshCorridorPathInput, barriers: MeshBarrier[], stats: CorridorMeshStats): CorridorMesh {
  const bounds = input.bounds
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) || !(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) throw new Error("Mesh corridor requires nondegenerate finite bounds")
  const layers = input.allowLayerChanges === false ? [input.start.z] : Array.from({ length: input.srj.layerCount }, (_, z): number => z)
  const maxPoints = input.maxMeshPoints ?? 50_000
  const maxWork = input.maxMeshConstructionWork ?? 5_000_000
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 4 || !Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error("Invalid explicit mesh construction allowance")
  const names = ["meshConstructionWork", "meshPrimitiveRings", "meshRingVertices", "meshSnapCoordinates", "meshUnionPairs", "meshUnionCalls", "meshUnionInputVertices", "meshUnionOutputVertices", "meshUnionFaces", "meshConstraintPointTests", "meshConstraints", "meshCdtCalls", "meshCdtInputPoints", "meshCdtTriangles", "meshConstraintVerification", "meshSites", "meshCells", "meshMemberships", "meshProjectionQueries", "meshProjectionCandidates", "meshPointProposals", "meshSweepCalls", "meshSweepInputPoints", "meshSweepTriangles", "meshExtrudedLayers", "meshDelaunayRefinementCalls", "meshEndpointAttachmentUnknowns"]
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
  const rings: XY[][] = []
  for (const barrier of barriers) {
    charge()
    if (barrier.viaOnly || !layers.some((z): boolean => barrier.minZ <= z && barrier.maxZ >= z) || barrier.maxX + padding < bounds.minX || barrier.minX - padding > bounds.maxX || barrier.maxY + padding < bounds.minY || barrier.minY - padding > bounds.maxY) continue
    const rawRing = clipRing(meshBarrierRing(barrier, padding), bounds)
    const ring = canonicalizeMeshRing(rawRing, bounds)
    stats.meshSnapCoordinates = (stats.meshSnapCoordinates as number) + rawRing.length * 2
    charge(ring.length)
    if (ring.length < 3) continue
    stats.meshPrimitiveRings = (stats.meshPrimitiveRings as number) + 1
    stats.meshRingVertices = (stats.meshRingVertices as number) + ring.length
    rings.push(ring)
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
  for (const ring of rings) for (const p of ring) addPoint(p)
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
  stats.meshSweepCalls = 1
  stats.meshCdtCalls = 1
  stats.meshSweepInputPoints = points.length
  stats.meshCdtInputPoints = points.length
  charge(points.length)
  const triangles = cdt2d(points.map((point): [number, number] => [point.x, point.y]), [], {
    delaunay: false, interior: true, exterior: true,
  })
  stats.meshSweepTriangles = triangles.length
  // Cumulative physically distinct layer cells, rather than repeated CDT work.
  stats.meshCdtTriangles = triangles.length * layers.length
  for (const z of layers) {
    const layerCells: number[] = []
    stats.meshExtrudedLayers = (stats.meshExtrudedLayers as number) + 1
    charge(triangles.length)
    for (const triangle of triangles) {
      const ps = triangle.map((id) => points[id]!)
      if (ps.some((p) => !p) || orientation([ps[0]!.x, ps[0]!.y], [ps[1]!.x, ps[1]!.y], [ps[2]!.x, ps[2]!.y]) === 0) throw new Error("CDT returned invalid triangle")
      const nodes = triangle.map((id): number => addSite(points[id]!, z))
      for (let i = 0; i < 3; i++) {
        const a = triangle[i]!, b = triangle[(i + 1) % 3]!
        nodes.push(addSite({ x: (points[a]!.x + points[b]!.x) / 2, y: (points[a]!.y + points[b]!.y) / 2 }, z))
      }
      nodes.push(addSite({ x: (ps[0]!.x + ps[1]!.x + ps[2]!.x) / 3, y: (ps[0]!.y + ps[1]!.y + ps[2]!.y) / 3 }, z))
      const id = cells.length
      cells.push({ vertices: [nodes[0]!, nodes[1]!, nodes[2]!], nodes: [...new Set(nodes)], z, bounds: boundsOf(ps) }); layerCells.push(id)
      for (const node of cells[id]!.nodes) { memberships[node]!.push(id); stats.meshMemberships = (stats.meshMemberships as number) + 1 }
    }
    if (!layerCells.length) throw new Error("CDT returned no cells for nondegenerate crop")
    const index = new Flatbush(layerCells.length)
    for (const id of layerCells) { const box = cells[id]!.bounds; index.add(box.minX, box.minY, box.maxX, box.maxY) }
    index.finish(); cellIndices.set(z, { index, ids: layerCells })
  }
  stats.meshSites = sites.length; stats.meshCells = cells.length
  if (!memberships[startId]!.length || !memberships[endId]!.length) {
    stats.meshEndpointAttachmentUnknowns = 1
    throw new CorridorMeshLimit("Monotone proposal mesh omitted an exact endpoint membership")
  }
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

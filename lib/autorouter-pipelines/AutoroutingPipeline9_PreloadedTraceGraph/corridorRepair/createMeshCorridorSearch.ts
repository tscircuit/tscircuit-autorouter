import Flatbush from "flatbush"
import { ClearancePathHeap } from "./ClearancePathHeap"
import { CorridorMeshLimit, meshTriangleContains, type CorridorMeshStats, type MeshBarrier, type MeshCorridorPathInput, type CorridorMesh } from "./buildConstrainedCorridorMesh"
import { buildMonotoneCorridorMesh } from "./buildMonotoneCorridorMesh"
import type { RepairRoutePoint } from "./repairRegionTypes"
import type { ClearancePathSearchStats } from "./findClearancePath"

type Point = RepairRoutePoint
type ViaPath = { x: number; y: number; previous?: ViaPath }
type Result = { status: "pending" } | { status: "finished"; path: Point[] | null; reason: ClearancePathSearchStats["completionReason"]; modelCost?: number }
type MeshSearchInput = {
  input: MeshCorridorPathInput; barriers: MeshBarrier[]
  clear(a: Point, b: Point): boolean; extraCost(a: Point, b: Point): number
  clearsDrills(point: Point, previous: ViaPath | undefined): boolean
  stats: ClearancePathSearchStats
}

export function createMeshCorridorCellVerifier(
  mesh: CorridorMesh, barriers: MeshBarrier[], clear: (a: Point, b: Point) => boolean, stats: CorridorMeshStats,
): (id: number) => boolean {
  const names = ["meshCellQueries", "meshCellCacheHits", "meshCellEdgeChecks", "meshCellEdgeCacheHits", "meshAnchorIndexQueries", "meshAnchorContainmentTests", "meshFreeCells", "meshBlockedCells"]
  for (const name of names) stats[name] = 0
  if (stats.corridorEdgeChecks === undefined) stats.corridorEdgeChecks = 0
  stats.meshAnchorIndexEntries = barriers.filter((barrier): boolean => !barrier.viaOnly).length
  const bump = (name: string, count = 1): void => { stats[name] = (stats[name] as number) + count }
  const hard = barriers.filter((barrier): boolean => !barrier.viaOnly)
  const anchorIndex = hard.length ? new Flatbush(hard.length) : undefined
  if (anchorIndex) {
    for (const barrier of hard) anchorIndex.add(barrier.a.x, barrier.a.y, barrier.a.x, barrier.a.y)
    anchorIndex.finish()
  }
  const cellFree = new Map<number, boolean>(), edgeFree = new Map<string, boolean>()
  const isCellFree = (id: number): boolean => {
    bump("meshCellQueries")
    const known = cellFree.get(id)
    if (known !== undefined) { bump("meshCellCacheHits"); return known }
    const cell = mesh.cells[id]!, vertices = cell.vertices.map((site): Point => mesh.sites[site]!)
    for (let edge = 0; edge < 3; edge++) {
      const a = cell.vertices[edge]!, b = cell.vertices[(edge + 1) % 3]!, key = `${Math.min(a, b)}:${Math.max(a, b)}`
      let permitted = edgeFree.get(key)
      if (permitted === undefined) { bump("meshCellEdgeChecks"); bump("corridorEdgeChecks"); permitted = clear(mesh.sites[a]!, mesh.sites[b]!); edgeFree.set(key, permitted) }
      else bump("meshCellEdgeCacheHits")
      if (!permitted) { cellFree.set(id, false); bump("meshBlockedCells"); return false }
    }
    // Every planar native forbidden primitive is connected and convex. If it
    // meets a triangle without meeting its boundary, the entire primitive is
    // inside, hence its centerline endpoint a (pad center for rectangles) is
    // inside too. Edge checks alone would miss such an internal hole.
    if (anchorIndex) {
      bump("meshAnchorIndexQueries")
      for (const candidate of anchorIndex.search(cell.bounds.minX, cell.bounds.minY, cell.bounds.maxX, cell.bounds.maxY)) {
        const barrier = hard[candidate]!
        if (barrier.minZ > cell.z || barrier.maxZ < cell.z) continue
        bump("meshAnchorContainmentTests")
        if (meshTriangleContains(barrier.a, vertices[0]!, vertices[1]!, vertices[2]!)) {
          cellFree.set(id, false); bump("meshBlockedCells"); return false
        }
      }
    }
    cellFree.set(id, true); bump("meshFreeCells"); return true
  }
  return isCellFree
}

/**
 * Layered proposal-only monotone convex-triangle mesh with local vertex/portal/centroid
 * transitions. No complete per-layer visibility clique or target-list sort.
 * Geometric cells are verified lazily; every emitted edge and via still calls
 * the original whole-edge physical oracle and the live nonnegative price.
 * This changes finite search policy, price subdivision, ties and drill-history
 * coalescing. Mesh exhaustion is not continuous or raster infeasibility.
 */
export function createMeshCorridorSearch({ input, barriers, clear, extraCost, clearsDrills, stats: rawStats }: MeshSearchInput): { step(): Result } {
  const stats = rawStats as CorridorMeshStats
  let mesh: ReturnType<typeof buildMonotoneCorridorMesh>
  try { mesh = buildMonotoneCorridorMesh(input, barriers, stats) }
  catch (error) {
    if (!(error instanceof CorridorMeshLimit)) throw error
    stats.meshGeometryLimits = 1
    return { step: (): Result => ({ status: "finished", path: null, reason: "geometry-limit" }) }
  }
  const names = ["meshCellQueries", "meshCellCacheHits", "meshCellEdgeChecks", "meshCellEdgeCacheHits", "meshAnchorIndexQueries", "meshAnchorContainmentTests", "meshFreeCells", "meshBlockedCells", "meshNeighborVisits", "meshGoalProposals", "meshViaProposals", "meshEdgeChecks", "meshPriceChecks", "meshQueuePushes", "meshExpandedSites", "meshSimplifyChecks", "meshGeometryLimits", "corridorEdgeChecks"]
  for (const name of names) stats[name] = 0
  const bump = (name: string, count = 1): void => { stats[name] = (stats[name] as number) + count }
  const isCellFree = createMeshCorridorCellVerifier(mesh, barriers, clear, stats)
  const heap = new ClearancePathHeap(), costs = new Map<number, number>([[mesh.startId, 0]])
  const parents = new Map<number, number>(), histories = new Map<number, ViaPath>(), settled = new Set<number>()
  const maxNodes = input.maxNodes ?? 30000, weight = input.heuristicWeight ?? 1
  const h = (p: Point): number => Math.hypot(p.x - input.end.x, p.y - input.end.y) + (p.z === input.end.z ? 0 : 1)
  heap.push({ id: mesh.startId, cost: 0, priority: weight * h(input.start) }); bump("meshQueuePushes")
  const relax = (from: number, to: number, cost: number, history: ViaPath | undefined, physicalChecked = false): void => {
    if (to === from || settled.has(to)) return
    const a = mesh.sites[from]!, b = mesh.sites[to]!
    const lower = cost + (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1)
    if (lower >= (costs.get(to) ?? Infinity)) return
    if (!physicalChecked) {
      bump("meshEdgeChecks"); bump("corridorEdgeChecks")
      if (!clear(a, b)) return
    }
    bump("meshPriceChecks")
    const next = lower + extraCost(a, b)
    if (!Number.isFinite(next) || next >= (costs.get(to) ?? Infinity)) return
    costs.set(to, next); parents.set(to, from)
    if (a.z !== b.z && (a.x !== history?.x || a.y !== history?.y)) histories.set(to, { x: a.x, y: a.y, previous: history })
    else if (history) histories.set(to, history)
    else histories.delete(to)
    heap.push({ id: to, cost: next, priority: next + weight * h(b) }); bump("meshQueuePushes")
  }
  const simplify = (path: Point[]): Point[] => {
    const prefix = [0], result: Point[] = [path[0]!]
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!
      bump("meshPriceChecks")
      prefix.push(prefix[i - 1]! + (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) + extraCost(a, b))
    }
    let anchor = 0
    for (let i = 1; i < path.length;) {
      let furthest = i
      if (path[i]!.z === result.at(-1)!.z) for (let j = i + 1; j < path.length && path[j]!.z === path[i]!.z; j++) {
        const a = result.at(-1)!, b = path[j]!
        bump("meshSimplifyChecks"); bump("meshEdgeChecks"); bump("corridorEdgeChecks")
        if (!clear(a, b)) continue
        bump("meshPriceChecks")
        if (Math.hypot(a.x - b.x, a.y - b.y) + extraCost(a, b) <= prefix[j]! - prefix[anchor]! + 1e-8) furthest = j
      }
      result.push(path[furthest]!); anchor = furthest; i = furthest + 1
    }
    return result
  }
  const step = (): Result => {
    try {
      for (let batch = 0; batch < 32 && heap.length && stats.nodesPopped < maxNodes; batch++) {
        const current = heap.pop(); stats.nodesPopped++
        if (current.cost !== costs.get(current.id) || settled.has(current.id)) continue
        if (current.id === mesh.endId) {
          const reversed: Point[] = []
          for (let id: number | undefined = mesh.endId; id !== undefined; id = parents.get(id)) reversed.push({ ...mesh.sites[id]! })
          const path = reversed.reverse()
          if (path.length === 1) path.push({ ...input.end })
          path[0] = { ...input.start }; path[path.length - 1] = { ...input.end }
          return { status: "finished", path: simplify(path), reason: "found", modelCost: current.cost }
        }
        settled.add(current.id); bump("meshExpandedSites")
        const a = mesh.sites[current.id]!, history = histories.get(current.id), neighbors = new Set<number>()
        for (const cellId of mesh.memberships[current.id]!) {
          if (!isCellFree(cellId)) continue
          for (const target of mesh.cells[cellId]!.nodes) { bump("meshNeighborVisits"); neighbors.add(target) }
        }
        if (a.z === input.end.z) { neighbors.add(mesh.endId); bump("meshGoalProposals") }
        for (const target of neighbors) relax(current.id, target, current.cost, history)
        if (input.allowLayerChanges !== false && clearsDrills(a, history)) {
          for (let z = 0; z < input.srj.layerCount; z++) {
            if (z === a.z) continue
            bump("meshViaProposals")
            const b: Point = { x: a.x, y: a.y, z, traceThickness: input.traceThickness }
            bump("meshEdgeChecks"); bump("corridorEdgeChecks")
            if (!clear(a, b)) continue
            const target = mesh.addProjection(a.x, a.y, z)
            relax(current.id, target, current.cost, history, true)
          }
        }
      }
    } catch (error) {
      if (!(error instanceof CorridorMeshLimit)) throw error
      bump("meshGeometryLimits")
      return { status: "finished", path: null, reason: "geometry-limit" }
    }
    if (heap.length && stats.nodesPopped < maxNodes) return { status: "pending" }
    return { status: "finished", path: null, reason: heap.length ? "node-limit" : "no-path" }
  }
  return { step }
}

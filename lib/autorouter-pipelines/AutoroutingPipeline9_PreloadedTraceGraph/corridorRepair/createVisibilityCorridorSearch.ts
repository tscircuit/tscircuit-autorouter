import type { HighDensityRoute } from "./repairTypes"
import { ClearancePathHeap } from "./ClearancePathHeap"
import type { ClearancePathInput, ClearancePathSearchStats } from "./findClearancePath"
import type { RepairRoutePoint } from "./repairRegionTypes"

type Point = RepairRoutePoint
type ViaPath = { x: number; y: number; previous?: ViaPath }
type BarrierBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  viaOnly?: boolean
}
type CorridorStats = ClearancePathSearchStats & {
  corridorSites?: number
  corridorProposals?: number
  corridorPointChecks?: number
  corridorEdgeChecks?: number
  corridorPriceChecks?: number
  corridorGeometricCandidates?: number
  corridorFamilyPops?: number
  corridorListSorts?: number
  corridorRetainedTargetsPeak?: number
}
export type CorridorPathInput = ClearancePathInput & {
  /** Mutable copper is guidance, never a substitute for the live cost oracle. */
  guideRoutes?: HighDensityRoute[]
}
type SearchResult =
  | { status: "pending" }
  | {
      status: "finished"
      path: Point[] | null
      reason: ClearancePathSearchStats["completionReason"]
    }
type SearchInput = {
  input: CorridorPathInput
  barriers: BarrierBounds[]
  clear: (a: Point, b: Point) => boolean
  extraCost: (a: Point, b: Point) => number
  clearsDrills: (point: Point, previous: ViaPath | undefined) => boolean
  stats: CorridorStats
}

/** Builds a finite geometric graph rather than enumerating cropped grid cells.
 * The graph is deliberately an incomplete routing policy: exhausted sites do
 * not certify that unrestricted continuous or raster routing is impossible.
 * Bounds generate proposals only; every vertex and complete edge uses the
 * native physical oracle and every accepted edge uses the live price oracle.
 */
export function createVisibilityCorridorSearch({
  input,
  barriers,
  clear,
  extraCost,
  clearsDrills,
  stats,
}: SearchInput): { step: () => SearchResult } {
  const { start, end, bounds } = input
  const sites: Point[] = [{ ...start }, { ...end }]
  const siteKeys = new Map<string, number>([
    [`${start.x}:${start.y}:${start.z}`, 0],
    [`${end.x}:${end.y}:${end.z}`, 1],
  ])
  const layerSites = new Map<number, number[]>()
  const coordinateSites = new Map<string, number[]>()
  const padding = input.traceThickness / 2 + Math.max(
    input.traceClearance,
    input.srj.defaultObstacleMargin ?? 0,
    input.srj.minTraceToPadEdgeClearance ?? 0,
    input.srj.minTraceToHoleEdgeClearance ?? 0,
  ) + 1e-6
  const layers = input.allowLayerChanges === false
    ? [start.z]
    : Array.from({ length: input.srj.layerCount }, (_, z): number => z)
  stats.corridorSites = 0
  stats.corridorProposals = 0
  stats.corridorPointChecks = 0
  stats.corridorEdgeChecks = 0
  stats.corridorPriceChecks = 0

  function addSite(x: number, y: number, z: number): void {
    stats.corridorProposals!++
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)
      return
    const key = `${x}:${y}:${z}`
    if (siteKeys.has(key)) return
    const p: Point = { x, y, z, traceThickness: input.traceThickness }
    stats.corridorPointChecks!++
    if (!clear(p, p)) return
    siteKeys.set(key, sites.length)
    sites.push(p)
  }

  function addBox(box: BarrierBounds, margin: number): void {
    const xs = [box.minX - margin, box.maxX + margin]
    const ys = [box.minY - margin, box.maxY + margin]
    for (const z of layers) {
      // Through-hole drill footprints also influence transitions on other layers.
      if (box.maxZ < z || box.minZ > z) continue
      for (const x of xs) for (const y of ys) addSite(x, y, z)
    }
  }

  for (const barrier of barriers) {
    if (!barrier.viaOnly) addBox(barrier, padding)
  }
  for (const guide of input.guideRoutes ?? []) {
    for (let index = 1; index < guide.route.length; index++) {
      const a = guide.route[index - 1]!, b = guide.route[index]!
      const isVia = a.z !== b.z
      const radius = (isVia ? guide.viaDiameter : guide.traceThickness) / 2
      addBox({
        minX: Math.min(a.x, b.x) - radius,
        maxX: Math.max(a.x, b.x) + radius,
        minY: Math.min(a.y, b.y) - radius,
        maxY: Math.max(a.y, b.y) + radius,
        minZ: isVia ? 0 : a.z,
        maxZ: isVia ? input.srj.layerCount - 1 : a.z,
      }, padding)
    }
  }
  for (const point of input.existingPath ?? []) addSite(point.x, point.y, point.z)
  // Project anchor columns onto all layers to offer physically checked via sites.
  for (const z of layers) {
    addSite(start.x, start.y, z)
    addSite(end.x, end.y, z)
  }
  for (let id = 0; id < sites.length; id++) {
    const point = sites[id]!
    const onLayer = layerSites.get(point.z)
    if (onLayer) onLayer.push(id)
    else layerSites.set(point.z, [id])
    const coordinate = `${point.x}:${point.y}`
    const inColumn = coordinateSites.get(coordinate)
    if (inColumn) inColumn.push(id)
    else coordinateSites.set(coordinate, [id])
  }
  stats.corridorSites = sites.length
  type Target = { id: number; geometric: number; priority: number }
  type Frontier = { source: number; cost: number; targets: Target[]; cursor: number; history?: ViaPath }
  const heap = new ClearancePathHeap(sites.length * 2)
  const costs = new Map<number, number>([[0, 0]])
  const parents = new Map<number, number>()
  const histories = new Map<number, ViaPath>()
  const settled = new Set<number>()
  const frontiers = new Map<number, Frontier>()
  const weight = input.heuristicWeight ?? 1
  const maxNodes = input.maxNodes ?? 30000
  let retainedTargets = 0
  stats.corridorGeometricCandidates = 0
  stats.corridorFamilyPops = 0
  stats.corridorListSorts = 0
  stats.corridorRetainedTargetsPeak = 0
  heap.push({ id: 0, cost: 0, priority: weight * Math.hypot(start.x - end.x, start.y - end.y) })

  function queueNext(frontier: Frontier): void {
    while (frontier.cursor < frontier.targets.length) {
      const target = frontier.targets[frontier.cursor]!
      if (!settled.has(target.id) && frontier.cost + target.geometric < (costs.get(target.id) ?? Infinity)) {
        heap.push({ id: sites.length + frontier.source, cost: frontier.cost, priority: target.priority })
        return
      }
      frontier.cursor++
    }
    retainedTargets -= frontier.targets.length
    frontiers.delete(frontier.source)
  }

  function expandSource(source: number, cost: number): void {
    const a = sites[source]!
    const history = histories.get(source)
    const planar = layerSites.get(a.z)
    if (!planar) throw new Error("Corridor site has no layer index")
    const column = coordinateSites.get(`${a.x}:${a.y}`)
    if (!column) throw new Error("Corridor site has no column index")
    const neighbors = input.allowLayerChanges === false || !clearsDrills(a, history)
      ? planar
      : planar.concat(column.filter((id): boolean => sites[id]!.z !== a.z))
    const targets: Target[] = []
    for (const id of neighbors) {
      if (id === source || settled.has(id)) continue
      const b = sites[id]!
      const geometric = a.z !== b.z ? 1 : Math.hypot(a.x - b.x, a.y - b.y)
      stats.corridorGeometricCandidates!++
      if (cost + geometric >= (costs.get(id) ?? Infinity)) continue
      const h = Math.hypot(b.x - end.x, b.y - end.y) + (b.z === end.z ? 0 : 1)
      const incumbent = costs.get(1)
      if (incumbent !== undefined && cost + geometric + h > incumbent + 1e-10) continue
      targets.push({ id, geometric, priority: cost + geometric + weight * h })
    }
    targets.sort((a, b): number => a.priority - b.priority || a.id - b.id)
    stats.corridorListSorts!++
    retainedTargets += targets.length
    stats.corridorRetainedTargetsPeak = Math.max(stats.corridorRetainedTargetsPeak!, retainedTargets)
    const frontier = { source, cost, targets, cursor: 0, history }
    frontiers.set(source, frontier)
    queueNext(frontier)
  }

  function evaluateFrontier(source: number): void {
    stats.corridorFamilyPops!++
    const frontier = frontiers.get(source)
    if (!frontier) throw new Error("Corridor queue references a missing source family")
    const target = frontier.targets[frontier.cursor++]
    if (!target) throw new Error("Corridor source family has no next target")
    const a = sites[source]!, b = sites[target.id]!
    const lowerBound = frontier.cost + target.geometric
    if (!settled.has(target.id) && lowerBound < (costs.get(target.id) ?? Infinity)) {
      stats.corridorEdgeChecks!++
      if (clear(a, b)) {
        stats.corridorPriceChecks!++
        const cost = lowerBound + extraCost(a, b)
        if (Number.isFinite(cost) && cost < (costs.get(target.id) ?? Infinity)) {
          costs.set(target.id, cost)
          parents.set(target.id, source)
          if (a.z !== b.z && (a.x !== frontier.history?.x || a.y !== frontier.history?.y))
            histories.set(target.id, { x: a.x, y: a.y, previous: frontier.history })
          else if (frontier.history) histories.set(target.id, frontier.history)
          else histories.delete(target.id)
          const h = Math.hypot(b.x - end.x, b.y - end.y) + (b.z === end.z ? 0 : 1)
          heap.push({ id: target.id, cost, priority: cost + weight * h })
        }
      }
    }
    queueNext(frontier)
  }

  function simplifyPath(path: Point[]): Point[] {
    const simplified: Point[] = [path[0]!]
    const prefixCosts = [0]
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!, b = path[index]!
      stats.corridorPriceChecks!++
      prefixCosts.push(prefixCosts[index - 1]! + (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) + extraCost(a, b))
    }
    let anchor = 0
    for (let index = 1; index < path.length;) {
      let furthest = index
      if (path[index]!.z === simplified.at(-1)!.z) {
        for (let target = index + 1; target < path.length && path[target]!.z === path[index]!.z; target++) {
          const a = simplified.at(-1)!, b = path[target]!
          stats.corridorEdgeChecks!++
          if (!clear(a, b)) continue
          stats.corridorPriceChecks!++
          if (Math.hypot(a.x - b.x, a.y - b.y) + extraCost(a, b) <= prefixCosts[target]! - prefixCosts[anchor]! + 1e-8)
            furthest = target
        }
      }
      simplified.push(path[furthest]!)
      anchor = furthest
      index = furthest + 1
    }
    return simplified
  }

  function step(): SearchResult {
    for (let batch = 0; batch < 32 && heap.length && stats.nodesPopped < maxNodes; batch++) {
      const current = heap.pop()
      stats.nodesPopped++
      if (current.id >= sites.length) {
        evaluateFrontier(current.id - sites.length)
        continue
      }
      if (current.cost !== costs.get(current.id) || settled.has(current.id)) continue
      if (current.id === 1) {
        const path: Point[] = []
        for (let id: number | undefined = 1; id !== undefined; id = parents.get(id))
          path.push({ ...sites[id]! })
        return { status: "finished", path: simplifyPath(path.reverse()), reason: "found" }
      }
      settled.add(current.id)
      expandSource(current.id, current.cost)
    }
    if (heap.length && stats.nodesPopped < maxNodes) return { status: "pending" }
    return {
      status: "finished",
      path: null,
      reason: heap.length ? "node-limit" : "no-path",
    }
  }

  return { step }
}

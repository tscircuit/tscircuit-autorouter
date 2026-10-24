import { getRepairCopperLayerSpan } from "./getRepairCopperLayerSpan"
import {
  segmentToBoundsMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "./repairTypes"
import { ClearancePathHeap } from "./ClearancePathHeap"
import { normalizeRepairTrace } from "./normalizeRepairTrace"
import { getViaPadClearance } from "./getViaPadClearance"
import { getConservativeRectBarrierBounds } from "./getConservativeRectBarrierBounds"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { REGION_EPSILON } from "./repairRegionGeometry"

type Point = RepairRoutePoint
type Barrier = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  radius: number
  viaOnly?: boolean
  pad?: boolean
  isNonPlatedHole?: boolean
  a: Point
  b: Point
  rect?: { width: number; height: number; rotation: number }
  rectCos: number
  rectSin: number
  rectBounds?: Bounds
  visitedQuery: number
}
type ViaPath = { x: number; y: number; previous?: ViaPath }

export type ClearancePathSearchStats = {
  nodesPopped: number
  completionReason: "found" | "no-path" | "node-limit" | "geometry-limit"
}

export type ClearancePathInput = Parameters<typeof findClearancePath>[0]

/** Clearance-aware routing between fixed anchors, using only cropped context. */
export function findClearancePath(input: {
  srj: SimpleRouteJson & { allowBlindAndBuriedVias?: boolean }
  routes: HighDensityRoute[]
  routeIndex: number
  start: Point
  end: Point
  bounds: Bounds
  traceThickness: number
  traceClearance: number
  viaClearance: number
  gridSize?: number
  /** Disable layer changes when searching for a trace-only repair. */
  allowLayerChanges?: boolean
  /** Maximum actual heap pops in this search; defaults to 30000. */
  maxNodes?: number
  /** Weight the distance estimate when a bounded search prioritizes finding a route. */
  heuristicWeight?: number
  /** Optional output accounting, overwritten for this synchronous call. */
  stats?: ClearancePathSearchStats
  /** Nonnegative congestion cost; Infinity prohibits the edge. */
  getAdditionalEdgeCost?: (start: Point, end: Point) => number
  /** Preserve this route when it already clears hard and movable copper. */
  existingPath?: Point[]
  /** Physical drill diameter; unknown drills reserve the copper diameter. */
  viaHoleDiameter?: number
}): Point[] | null {
  const { srj, routes, routeIndex, start, end, bounds, traceThickness } = input
  const heuristicWeight = input.heuristicWeight ?? 1
  if (!Number.isFinite(heuristicWeight) || heuristicWeight < 1)
    throw new Error(
      "repair04: heuristic weight must be finite and at least one",
    )
  const extraCost = (a: Point, b: Point): number => {
    const value = input.getAdditionalEdgeCost?.(a, b) ?? 0
    if (Number.isNaN(value) || value < 0)
      throw new Error("repair04: additional edge costs must be nonnegative")
    return value
  }
  if (
    input.maxNodes !== undefined &&
    (!Number.isSafeInteger(input.maxNodes) || input.maxNodes < 1)
  )
    throw new Error("repair04: maxNodes must be a positive safe integer")
  if (input.stats) {
    input.stats.nodesPopped = 0
    input.stats.completionReason = "no-path"
  }
  if (input.allowLayerChanges === false && start.z !== end.z) return null
  const route = routes[routeIndex]!
  const drillDiameter = input.viaHoleDiameter ?? route.viaDiameter
  if (
    !Number.isFinite(drillDiameter) ||
    drillDiameter <= 0 ||
    drillDiameter > route.viaDiameter
  )
    throw new Error(
      "repair04: via hole diameter must be positive and fit the copper",
    )
  const drillSpacing = drillDiameter + input.viaClearance
  const clearsDrills = (
    point: Point,
    viaPath: ViaPath | undefined,
  ): boolean => {
    for (let via = viaPath; via; via = via.previous) {
      if (point.x === via.x && point.y === via.y) continue
      if (
        Math.hypot(point.x - via.x, point.y - via.y) + REGION_EPSILON <
        drillSpacing
      )
        return false
    }
    return true
  }
  const pathClearsDrills = (path: Point[]): boolean => {
    let vias: ViaPath | undefined
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!,
        b = path[index]!
      if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
      if (!clearsDrills(a, vias)) return false
      if (a.x !== vias?.x || a.y !== vias?.y)
        vias = { x: a.x, y: a.y, previous: vias }
    }
    return true
  }
  const parents = new Map<string, string>()
  const net = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined || parent === name) return name
    const root = net(parent)
    parents.set(name, root)
    return root
  }
  const join = (names: Array<string | undefined>): void => {
    const present = names.filter((n): n is string => Boolean(n))
    if (!present.length) return
    const root = net(present[0]!)
    for (const name of present) parents.set(net(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    join([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((p) => [p.pcb_port_id, p.pointId]),
    ])
  }
  for (const obstacle of srj.obstacles) join(obstacle.connectedTo)
  for (const r of routes) join([r.connectionName, r.rootConnectionName])
  const owner = net(route.connectionName)
  const layer = (name: string): number =>
    name === "top"
      ? 0
      : name === "bottom"
        ? srj.layerCount - 1
        : Number(name.slice(5))
  // Tight bounds are only used where rounding is small relative to the
  // outward margin. Outside this ordinary PCB domain, preserve the old path.
  const ordinaryBoundsDomain = [
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    start.x,
    start.y,
    end.x,
    end.y,
    traceThickness,
    route.viaDiameter,
    input.traceClearance,
    input.viaClearance,
    srj.defaultObstacleMargin ?? 0,
    srj.minTraceToPadEdgeClearance ?? 0,
    srj.minTraceToHoleEdgeClearance ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0,
  ].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000)
  const barriers: Barrier[] = []
  const add = (
    a: Point,
    b: Point,
    radius: number,
    rect?: Barrier["rect"],
    viaOnly = false,
    pad = false,
    isNonPlatedHole = false,
  ): void => {
    const extent = rect ? Math.hypot(rect.width, rect.height) / 2 : radius
    const rectCos = rect ? Math.cos(rect.rotation) : 1
    const rectSin = rect ? Math.sin(rect.rotation) : 0
    const originalBounds = {
      minX: Math.min(a.x, b.x) - extent,
      maxX: Math.max(a.x, b.x) + extent,
      minY: Math.min(a.y, b.y) - extent,
      maxY: Math.max(a.y, b.y) + extent,
    }
    const barrierBounds =
      rect && ordinaryBoundsDomain
        ? getConservativeRectBarrierBounds(
            a,
            b,
            rect,
            rectCos,
            rectSin,
            originalBounds,
          )
        : originalBounds
    barriers.push({
      a,
      b,
      radius,
      rect,
      viaOnly,
      pad,
      isNonPlatedHole,
      rectCos,
      rectSin,
      rectBounds: rect
        ? {
            minX: -rect.width / 2,
            maxX: rect.width / 2,
            minY: -rect.height / 2,
            maxY: rect.height / 2,
          }
        : undefined,
      visitedQuery: 0,
      ...barrierBounds,
      ...getRepairCopperLayerSpan(srj, a, b),
    })
  }
  for (const obstacle of srj.obstacles) {
    // A wire may enter its own pad. A via's annulus must remain outside it.
    const viaOnly = obstacle.connectedTo.some((name) => net(name) === owner)
    const zs =
      (obstacle as typeof obstacle & { __zLayers?: number[] }).__zLayers ??
      obstacle.zLayers ??
      obstacle.layers.map(layer)
    const circularObstacle =
      (obstacle.isNonPlatedHole && obstacle.shape === "circle") ||
      (obstacle.type === "oval" &&
        obstacle.width === obstacle.height &&
        obstacle.ccwRotationDegrees === undefined &&
        zs.length > 1)
    for (const z of zs) {
      // Circular holes and round through-hole copper use their physical outline.
      // Other pads retain the conservative rectangle used for validation.
      const center = { ...obstacle.center, z }
      add(
        center,
        center,
        circularObstacle ? obstacle.width / 2 : 0,
        circularObstacle
          ? undefined
          : {
              width: obstacle.width,
              height: obstacle.height,
              rotation: ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180,
            },
        viaOnly,
        circularObstacle,
        obstacle.isNonPlatedHole,
      )
    }
  }
  for (const other of routes) {
    if (net(other.connectionName) === owner) continue
    for (let i = 1; i < other.route.length; i++) {
      const a = other.route[i - 1]! as Point,
        b = other.route[i]! as Point
      if (a.toNextSegmentType === "through_obstacle") continue
      add(
        a,
        b,
        a.z !== b.z
          ? other.viaDiameter / 2
          : Math.max(
              a.traceThickness ?? other.traceThickness,
              b.traceThickness ?? other.traceThickness,
            ) / 2,
      )
    }
  }
  for (const raw of srj.traces ?? []) {
    if (net(raw.connection_name) === owner) continue
    const trace = normalizeRepairTrace(raw, srj.minTraceWidth)
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]!,
        b = trace.route[i]!
      if (
        a.route_type === "wire" &&
        b.route_type === "wire" &&
        a.layer === b.layer
      )
        add(
          { x: a.x, y: a.y, z: layer(a.layer) },
          { x: b.x, y: b.y, z: layer(b.layer) },
          Math.max(a.width, b.width) / 2,
        )
      if (b.route_type === "via")
        add(
          { x: b.x, y: b.y, z: layer(b.from_layer) },
          { x: b.x, y: b.y, z: layer(b.to_layer) },
          (b.via_diameter ?? route.viaDiameter) / 2,
        )
    }
  }
  const cells = new Map<number, Map<number, Barrier[]>>()
  const queryReach =
    Math.max(route.viaDiameter, traceThickness) / 2 +
    Math.max(
      input.traceClearance,
      input.viaClearance,
      srj.defaultObstacleMargin ?? 0,
      srj.minTraceToPadEdgeClearance ?? 0,
      srj.minTraceToHoleEdgeClearance ?? 0,
      srj.minViaEdgeToPadEdgeClearance ?? 0,
    ) +
    1e-5
  for (const barrier of barriers) {
    for (
      let x = Math.floor(Math.max(barrier.minX, bounds.minX - queryReach));
      x <= Math.floor(Math.min(barrier.maxX, bounds.maxX + queryReach));
      x++
    ) {
      let column = cells.get(x)
      for (
        let y = Math.floor(Math.max(barrier.minY, bounds.minY - queryReach));
        y <= Math.floor(Math.min(barrier.maxY, bounds.maxY + queryReach));
        y++
      ) {
        if (!column) {
          column = new Map<number, Barrier[]>()
          cells.set(x, column)
        }
        const bucket = column.get(y)
        if (bucket) bucket.push(barrier)
        else column.set(y, [barrier])
      }
    }
  }
  let queryId = 0
  // Exact-distance helpers are synchronous and retain no point references.
  const localA = { x: 0, y: 0 }
  const localB = { x: 0, y: 0 }
  const clear = (a: Point, b: Point): boolean => {
    const isVia = a.z !== b.z
    const radius = isVia ? route.viaDiameter / 2 : traceThickness / 2
    const margin = Math.max(
      isVia ? input.viaClearance : input.traceClearance,
      srj.defaultObstacleMargin ?? 0,
      isVia
        ? (srj.minViaEdgeToPadEdgeClearance ?? 0)
        : (srj.minTraceToPadEdgeClearance ?? 0),
    )
    const reach =
      radius + Math.max(margin, srj.minTraceToHoleEdgeClearance ?? 0) + 1e-5
    // Barriers belong to this synchronous search only. A visit stamp preserves
    // the original first-seen order without allocating a Set for each edge.
    const currentQuery = ++queryId
    const minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y),
      maxY = Math.max(a.y, b.y)
    const { minZ, maxZ } = getRepairCopperLayerSpan(srj, a, b)
    for (let x = Math.floor(minX - reach); x <= Math.floor(maxX + reach); x++) {
      const column = cells.get(x)
      if (!column) continue
      for (
        let y = Math.floor(minY - reach);
        y <= Math.floor(maxY + reach);
        y++
      ) {
        const bucket = column.get(y)
        if (!bucket) continue
        for (const barrier of bucket) {
          if (barrier.viaOnly && !isVia) continue
          if (barrier.visitedQuery === currentQuery) continue
          barrier.visitedQuery = currentQuery
          if (barrier.maxZ < minZ || barrier.minZ > maxZ) continue
          const requiredGap =
            barrier.isNonPlatedHole &&
            !isVia &&
            srj.minTraceToHoleEdgeClearance !== undefined
              ? srj.minTraceToHoleEdgeClearance
              : barrier.viaOnly
                ? getViaPadClearance(srj, input.viaClearance, true)
                : barrier.rect || barrier.pad
                  ? margin
                  : isVia && barrier.minZ !== barrier.maxZ
                    ? input.viaClearance
                    : input.traceClearance
          const clearance = radius + requiredGap
          // These bounds enclose the entire copper/rotated obstacle. Strict
          // separation can only rule out a collision; exact boundary cases
          // still use the same distance calculation and tolerance below.
          if (
            maxX + clearance < barrier.minX ||
            minX - clearance > barrier.maxX ||
            maxY + clearance < barrier.minY ||
            minY - clearance > barrier.maxY
          )
            continue
          let distance: number
          if (barrier.rect) {
            localA.x =
              (a.x - barrier.a.x) * barrier.rectCos +
              (a.y - barrier.a.y) * barrier.rectSin
            localA.y =
              -(a.x - barrier.a.x) * barrier.rectSin +
              (a.y - barrier.a.y) * barrier.rectCos
            localB.x =
              (b.x - barrier.a.x) * barrier.rectCos +
              (b.y - barrier.a.y) * barrier.rectSin
            localB.y =
              -(b.x - barrier.a.x) * barrier.rectSin +
              (b.y - barrier.a.y) * barrier.rectCos
            distance = segmentToBoundsMinDistance(
              localA,
              localB,
              barrier.rectBounds!,
            )
          } else
            distance =
              segmentToSegmentMinDistance(a, b, barrier.a, barrier.b) -
              barrier.radius
          // Keep exactly feasible corridors open within coordinate precision.
          if (distance + REGION_EPSILON < clearance) return false
        }
      }
    }
    return true
  }
  if (!clear(start, start) || !clear(end, end)) return null
  if (input.existingPath) {
    const path = input.existingPath
    const first = path[0],
      last = path.at(-1)
    if (
      !first ||
      !last ||
      first.x !== start.x ||
      first.y !== start.y ||
      first.z !== start.z ||
      last.x !== end.x ||
      last.y !== end.y ||
      last.z !== end.z
    )
      throw new Error(
        "repair04: existing clearance path must match its anchors",
      )
    if (
      path.some((point, index): boolean => {
        const previous = path[index - 1]
        return Boolean(
          previous &&
            previous.z !== point.z &&
            (previous.x !== point.x || previous.y !== point.y),
        )
      })
    )
      throw new Error(
        "repair04: existing clearance path has a non-colocated layer transition",
      )
    if (
      pathClearsDrills(path) &&
      (input.allowLayerChanges !== false ||
        path.every((point): boolean => point.z === start.z)) &&
      path
        .slice(1)
        .every(
          (point, index): boolean =>
            clear(path[index]!, point) && extraCost(path[index]!, point) === 0,
        )
    ) {
      if (input.stats) input.stats.completionReason = "found"
      return path.map((point): Point => ({ ...point }))
    }
  }
  const grid = input.gridSize ?? 0.1
  if (!Number.isFinite(grid) || grid <= 0)
    throw new Error("repair04: clearance grid size must be positive and finite")
  const nx = Math.floor((bounds.maxX - bounds.minX) / grid)
  const ny = Math.floor((bounds.maxY - bounds.minY) / grid)
  const point = (id: number): Point => ({
    x: bounds.minX + ((id % nx) + 0.5) * grid,
    y: bounds.minY + ((Math.floor(id / nx) % ny) + 0.5) * grid,
    z: Math.floor(id / (nx * ny)),
    traceThickness,
  })
  const idAt = (x: number, y: number, z: number): number =>
    (z * ny + y) * nx + x
  const idOf = (p: Point): number =>
    idAt(
      Math.max(0, Math.min(nx - 1, Math.floor((p.x - bounds.minX) / grid))),
      Math.max(0, Math.min(ny - 1, Math.floor((p.y - bounds.minY) / grid))),
      p.z,
    )
  const heuristic = (p: Point): number =>
    Math.hypot(p.x - end.x, p.y - end.y) + (p.z === end.z ? 0 : 1)
  const denseNodeCount = nx * ny * srj.layerCount
  // Bound dense queue storage to 4 MB; unusually large grids remain sparse.
  const useDenseStorage =
    nx > 0 &&
    ny > 0 &&
    Number.isSafeInteger(srj.layerCount) &&
    Number.isSafeInteger(denseNodeCount) &&
    denseNodeCount > 0 &&
    denseNodeCount <= 1_000_000 &&
    Number.isInteger(start.z) &&
    start.z >= 0 &&
    start.z < srj.layerCount
  const heap = new ClearancePathHeap(
    useDenseStorage ? denseNodeCount : undefined,
  )
  const costs = new Map<number, number>()
  const previous = new Map<number, number>()
  const viaPaths = new Map<number, ViaPath | undefined>()
  const startId = idOf(start),
    sx = startId % nx,
    sy = Math.floor(startId / nx) % ny
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = sx + dx,
        y = sy + dy
      if (x < 0 || x >= nx || y < 0 || y >= ny) continue
      const id = idAt(x, y, start.z),
        p = point(id)
      if (!clear(start, p)) continue
      const cost =
        Math.hypot(p.x - start.x, p.y - start.y) + extraCost(start, p)
      if (!Number.isFinite(cost)) continue
      costs.set(id, cost)
      previous.set(id, -1)
      heap.push({ id, cost, priority: cost + heuristicWeight * heuristic(p) })
    }
  const gridNodeCount = nx * ny * srj.layerCount
  // Only pack edges when every grid-node pair has an exact integer key.
  const useNumericEdgeKeys =
    nx > 0 &&
    ny > 0 &&
    Number.isSafeInteger(srj.layerCount) &&
    Number.isSafeInteger(gridNodeCount) &&
    gridNodeCount > 0 &&
    Number.isSafeInteger(gridNodeCount * gridNodeCount - 1) &&
    Number.isInteger(start.z) &&
    start.z >= 0 &&
    start.z < srj.layerCount
  // Weighted search prioritizes a feasible path over the shortest path. Settle
  // each grid state once so inconsistent weighted estimates cannot repeatedly
  // reopen it and exhaust the bounded repair allowance.
  const settled = heuristicWeight > 1 ? new Set<number>() : undefined
  const edgeCache = new Map<number | string, boolean>()
  // Ordinary vias have the same hard clearance on every electrical layer
  // pair. Reuse that result at each grid site; blind vias retain edge keys.
  const fullStackViaClearance = new Map<number, boolean>()
  let expanded = 0
  while (heap.length && expanded < (input.maxNodes ?? 30000)) {
    const current = heap.pop()
    expanded++
    if (input.stats) input.stats.nodesPopped = expanded
    if (current.cost !== costs.get(current.id)) continue
    settled?.add(current.id)
    const a = point(current.id)
    const viaPath = viaPaths.get(current.id)
    if (
      a.z === end.z &&
      Math.hypot(a.x - end.x, a.y - end.y) < grid * 3 &&
      clear(a, end) &&
      Number.isFinite(extraCost(a, end))
    ) {
      const reversed: Point[] = [end]
      for (let id = current.id; id !== -1; id = previous.get(id)!)
        reversed.push(point(id))
      reversed.push(start)
      const path = reversed.reverse(),
        simplified: Point[] = [start]
      const pathCosts = [0]
      for (let i = 1; input.getAdditionalEdgeCost && i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!
        pathCosts.push(
          pathCosts[i - 1]! +
            (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) +
            extraCost(a, b),
        )
      }
      let anchor = 0
      for (let i = 1; i < path.length; ) {
        let furthest = i
        if (path[i]!.z === simplified.at(-1)!.z) {
          for (let j = i + 1; j < path.length && path[j]!.z === path[i]!.z; j++)
            if (
              clear(simplified.at(-1)!, path[j]!) &&
              (!input.getAdditionalEdgeCost ||
                Math.hypot(
                  path[j]!.x - path[anchor]!.x,
                  path[j]!.y - path[anchor]!.y,
                ) +
                  extraCost(path[anchor]!, path[j]!) <=
                  pathCosts[j]! - pathCosts[anchor]! + REGION_EPSILON)
            )
              furthest = j
        }
        simplified.push(path[furthest]!)
        anchor = furthest
        i = furthest + 1
      }
      if (!pathClearsDrills(simplified))
        throw new Error("repair04: search generated conflicting drill sites")
      if (input.stats) input.stats.completionReason = "found"
      return simplified
    }
    const x = current.id % nx,
      y = Math.floor(current.id / nx) % ny
    const neighbors: number[] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (
          (dx === 0 && dy === 0) ||
          x + dx < 0 ||
          x + dx >= nx ||
          y + dy < 0 ||
          y + dy >= ny
        )
          continue
        neighbors.push(idAt(x + dx, y + dy, a.z))
      }
    if (input.allowLayerChanges !== false && clearsDrills(a, viaPath)) {
      for (let z = 0; z < srj.layerCount; z++)
        if (z !== a.z) neighbors.push(idAt(x, y, z))
    }
    for (const id of neighbors) {
      if (settled?.has(id)) continue
      const b = point(id),
        baseCost =
          current.cost + (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1),
        previousCost = costs.get(id) ?? Infinity
      // Congestion costs are nonnegative, so an edge that cannot improve the
      // geometric cost cannot improve the complete cost either.
      if (baseCost >= previousCost) continue
      // Hard-blocked edges cannot enter the queue. Avoid the more expensive
      // movable-copper congestion query for those edges.
      const low = Math.min(current.id, id),
        high = Math.max(current.id, id)
      const key = useNumericEdgeKeys
        ? low * gridNodeCount + high
        : `${low},${high}`
      const fullStackViaKey =
        useNumericEdgeKeys &&
        a.z !== b.z &&
        srj.allowBlindAndBuriedVias !== true
          ? current.id % (nx * ny)
          : undefined
      let permitted =
        fullStackViaKey === undefined
          ? edgeCache.get(key)
          : fullStackViaClearance.get(fullStackViaKey)
      if (permitted === undefined) {
        permitted = clear(a, b)
        if (fullStackViaKey === undefined) edgeCache.set(key, permitted)
        else fullStackViaClearance.set(fullStackViaKey, permitted)
      }
      if (!permitted) continue
      const cost = baseCost + extraCost(a, b)
      if (cost >= previousCost) continue
      if (a.z !== b.z && (a.x !== viaPath?.x || a.y !== viaPath?.y))
        viaPaths.set(id, { x: a.x, y: a.y, previous: viaPath })
      else if (viaPath) viaPaths.set(id, viaPath)
      else viaPaths.delete(id)
      costs.set(id, cost)
      previous.set(id, current.id)
      heap.push({ id, cost, priority: cost + heuristicWeight * heuristic(b) })
    }
  }
  if (input.stats)
    input.stats.completionReason = heap.length ? "node-limit" : "no-path"
  return null
}

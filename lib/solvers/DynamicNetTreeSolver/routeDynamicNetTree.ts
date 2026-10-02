import type { SimplifiedPcbTrace } from "../../types"
import { minimumDistanceBetweenSegments } from "../../utils/minimumDistanceBetweenSegments"
import {
  copperRectangleCorners,
  copperTouches,
  pointInOutline,
  projectToCopper,
  segmentCopperGap,
  type TreeCopper,
  type TreePoint,
} from "./dynamicNetTreeGeometry"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import { findZeroViaCopperForest } from "./findZeroViaCopperForest"

export type DynamicNetTreeProblem = {
  net: string
  layerCount: number
  allowBlindAndBuriedVias: boolean
  terminals: { id: string; point: TreePoint; layers: number[] }[]
  copper: TreeCopper[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline: TreePoint[]
  width: number
  clearance: number
  viaToPadClearance?: number
  traceToHoleClearance?: number
  platedHoleClearance?: number
  boardEdgeClearance: number
  viaDiameter: number
  viaHoleDiameter: number
  holeClearance: number
  allowViaInPad: boolean
}
export type DynamicNetTreeOptions = {
  gridStep: number
  viaCost: number
  bendCost: number
  maxExpansions: number
  maxMilliseconds: number
  /** Hard physical new-via caps; omitted preserves the unbounded search. */
  maxViasPerBranch?: number
  maxViasPerNet?: number
  /** Join physically reachable same-layer components before allocating vias. */
  componentPlanning?: "zero-via-forest"
}
export type DynamicTreeAttachment = {
  branchId: string
  sourceCopperId: string
  targetCopperId: string
  source: TreePoint
  sourceLayer: number
  cost: number
}
export type DynamicNetTreeResult = {
  solved: boolean
  error?: string
  traces: SimplifiedPcbTrace[]
  attachments: DynamicTreeAttachment[]
  stats: {
    zeroViaForestExpansions: number
    zeroViaForestJoins: number
    insertedVias: number
    rootCopperId: string
    expansions: number
    searches: number
    branches: number
    elapsedMs: number
    initialComponents: number
    finalComponents: number
  }
}
/** A recorded physical branch insertion, never an accepted board output. */
export type DynamicNetTreeProgress = {
  kind: "forest" | "tree"
  net: string
  traces: SimplifiedPcbTrace[]
  branches: number
  components: number
  initialComponents: number
  insertedVias: number
  expansions: number
}
export type CopperConnector = {
  point: TreePoint
  copperId: string
  cost: number
  z: number
  path: TreePoint[]
}
type Connector = CopperConnector
type HeapEntry = { state: number; cost: number; priority: number }
type GridPoint = TreePoint & { z: number }
const directions = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const

class RoutingRejection extends Error {}

class TreeSearchHeap {
  private items: HeapEntry[] = []
  push(entry: HeapEntry): void {
    let i = this.items.length
    this.items.push(entry)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.compare(this.items[p]!, entry) <= 0) break
      this.items[i] = this.items[p]!
      i = p
    }
    this.items[i] = entry
  }
  pop(): HeapEntry | undefined {
    const first = this.items[0],
      last = this.items.pop()
    if (!last || this.items.length === 0) return first
    let i = 0
    while (i * 2 + 1 < this.items.length) {
      let c = i * 2 + 1
      if (
        c + 1 < this.items.length &&
        this.compare(this.items[c + 1]!, this.items[c]!) < 0
      )
        c++
      if (this.compare(last, this.items[c]!) <= 0) break
      this.items[i] = this.items[c]!
      i = c
    }
    this.items[i] = last
    return first
  }
  private compare(a: HeapEntry, b: HeapEntry): number {
    return a.priority - b.priority || a.cost - b.cost || a.state - b.state
  }
}

/** Opt-in physical net search. Existing copper is immutable. Failed transactions
 * expose no candidate traces. This does not call NetToPointPairsSolver. */
export function* routeDynamicNetTreeSteps(
  problem: DynamicNetTreeProblem,
  options: DynamicNetTreeOptions,
): Generator<DynamicNetTreeProgress, DynamicNetTreeResult> {
  problem = structuredClone(problem)
  options = structuredClone(options)
  const started = performance.now()
  let pausedMilliseconds = 0
  const elapsed = (): number => performance.now() - started - pausedMilliseconds
  if (
    options.gridStep <= 0 ||
    options.viaCost < 0 ||
    options.bendCost < 0 ||
    problem.width <= 0 ||
    problem.clearance < 0 ||
    problem.viaDiameter <= problem.viaHoleDiameter ||
    problem.terminals.length === 0
  )
    throw new Error("Invalid dynamic net-tree rules or search options")
  if (
    !Number.isInteger(problem.layerCount) ||
    problem.layerCount < 2 ||
    problem.layerCount > 10 ||
    problem.copper.some((c) =>
      c.layers.some(
        (z) => !Number.isInteger(z) || z < 0 || z >= problem.layerCount,
      ),
    ) ||
    problem.terminals.some(
      (t) =>
        t.layers.length === 0 ||
        t.layers.some(
          (z) => !Number.isInteger(z) || z < 0 || z >= problem.layerCount,
        ),
    )
  )
    throw new Error("Invalid dynamic net-tree physical layer")
  const numericRules = [
    options.gridStep,
    options.viaCost,
    options.bendCost,
    options.maxExpansions,
    options.maxMilliseconds,
    problem.width,
    problem.clearance,
    problem.viaToPadClearance ?? problem.clearance,
    problem.traceToHoleClearance ?? problem.clearance,
    problem.platedHoleClearance ?? problem.holeClearance,
    problem.boardEdgeClearance,
    problem.viaDiameter,
    problem.viaHoleDiameter,
    problem.holeClearance,
    ...Object.values(problem.bounds),
  ]
  if (
    numericRules.some((v) => !Number.isFinite(v)) ||
    options.maxExpansions < 1 ||
    options.maxMilliseconds <= 0 ||
    problem.boardEdgeClearance < 0 ||
    problem.holeClearance < 0 ||
    (problem.viaToPadClearance ?? problem.clearance) < 0 ||
    (problem.traceToHoleClearance ?? problem.clearance) < 0 ||
    (problem.platedHoleClearance ?? problem.holeClearance) < 0 ||
    problem.viaHoleDiameter <= 0 ||
    problem.outline.length < 3 ||
    problem.bounds.minX >= problem.bounds.maxX ||
    problem.bounds.minY >= problem.bounds.maxY
  )
    throw new Error("Invalid finite board/search budget")
  for (const budget of [options.maxViasPerBranch, options.maxViasPerNet])
    if (
      budget !== undefined &&
      (!Number.isInteger(budget) || budget < 0 || budget > 32)
    )
      throw new Error("Invalid bounded integer via budget")
  if (
    options.componentPlanning !== undefined &&
    options.componentPlanning !== "zero-via-forest"
  )
    throw new Error("Invalid physical component planning policy")
  const copper = structuredClone(problem.copper)
  for (const c of copper) {
    if (
      ![
        c.start.x,
        c.start.y,
        c.end.x,
        c.end.y,
        c.radius,
        ...(c.rectangle ? Object.values(c.rectangle) : []),
        ...(c.routingEnvelope ? Object.values(c.routingEnvelope) : []),
        ...(c.drill
          ? [
              c.drill.start.x,
              c.drill.start.y,
              c.drill.end.x,
              c.drill.end.y,
              c.drill.diameter,
            ]
          : []),
      ].every(Number.isFinite) ||
      c.radius < 0 ||
      c.layers.length === 0 ||
      (c.routingEnvelope &&
        (c.routingEnvelope.width <= 0 || c.routingEnvelope.height <= 0)) ||
      (c.drill &&
        (c.drill.diameter <= 0 ||
          c.drill.layers.length === 0 ||
          c.drill.layers.some(
            (z) => !Number.isInteger(z) || z < 0 || z >= problem.layerCount,
          )))
    )
      throw new Error(`Invalid dynamic net-tree copper ${c.id}`)
  }
  const terminalCopperIds = new Map<string, Set<string>>()
  for (const terminal of problem.terminals) {
    if (terminalCopperIds.has(terminal.id))
      throw new Error(`Duplicate terminal identity ${terminal.id}`)
    terminalCopperIds.set(terminal.id, new Set())
    for (const z of terminal.layers) {
      const id = `terminal:${terminal.id}:${z}`
      terminalCopperIds.get(terminal.id)!.add(id)
      copper.push({
        id,
        owner: problem.net,
        layers: [z],
        start: terminal.point,
        end: terminal.point,
        radius: 0,
        kind: "terminal",
      })
    }
  }
  if (new Set(copper.map((c) => c.id)).size !== copper.length)
    throw new Error("Duplicate physical copper identity")
  let expansions = 0,
    zeroViaForestExpansions = 0,
    zeroViaForestJoins = 0,
    searches = 0,
    insertedVias = 0
  const traces: SimplifiedPcbTrace[] = [],
    attachments: DynamicTreeAttachment[] = []
  const h = options.gridStep,
    bounds = problem.bounds
  const nx = Math.floor((bounds.maxX - bounds.minX) / h) + 1,
    ny = Math.floor((bounds.maxY - bounds.minY) / h) + 1
  const plane = nx * ny,
    cellCount = plane * problem.layerCount
  const point = (cell: number): GridPoint => ({
    x: bounds.minX + (cell % nx) * h,
    y: bounds.minY + Math.floor((cell % plane) / nx) * h,
    z: Math.floor(cell / plane),
  })
  const ownCopper = (): TreeCopper[] =>
    copper.filter((c) => c.owner === problem.net)
  // Geometrical contact, not string aliases or initially-connected claims.
  function components(): TreeCopper[][] {
    const own = ownCopper(),
      parent = own.map((_, i) => i)
    function find(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!
        i = parent[i]!
      }
      return i
    }
    for (let i = 0; i < own.length; i++)
      for (let j = 0; j < i; j++)
        if (copperTouches(own[i]!, own[j]!)) parent[find(i)] = find(j)
    const groups = new Map<number, TreeCopper[]>()
    own.forEach((c, i) => {
      const root = find(i)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(c)
    })
    return [...groups.values()]
  }
  const initialComponents = components().length
  const rootId: string = `terminal:${problem.terminals[0]!.id}:${problem.terminals[0]!.layers[0]}`
  const bins = new Map<string, TreeCopper[]>(),
    binSize = 2
  function addToBins(c: TreeCopper): void {
    const corners = c.rectangle ? copperRectangleCorners(c) : [c.start, c.end]
    if (c.drill) corners.push(c.drill.start, c.drill.end)
    if (c.routingEnvelope)
      corners.push(
        ...copperRectangleCorners({
          ...c,
          start: c.drill?.start ?? {
            x: (c.start.x + c.end.x) / 2,
            y: (c.start.y + c.end.y) / 2,
          },
          rectangle: c.routingEnvelope,
          radius: 0,
        }),
      )
    const r =
      Math.max(c.radius, (c.drill?.diameter ?? c.holeDiameter ?? 0) / 2) +
      Math.max(problem.viaDiameter / 2, problem.width / 2) +
      Math.max(
        problem.clearance,
        problem.viaToPadClearance ?? 0,
        problem.traceToHoleClearance ?? 0,
        problem.platedHoleClearance ?? 0,
        problem.holeClearance,
      ) +
      0.01
    const x0 = Math.floor((Math.min(...corners.map((p) => p.x)) - r) / binSize),
      x1 = Math.floor((Math.max(...corners.map((p) => p.x)) + r) / binSize)
    const y0 = Math.floor((Math.min(...corners.map((p) => p.y)) - r) / binSize),
      y1 = Math.floor((Math.max(...corners.map((p) => p.y)) + r) / binSize)
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`
        if (!bins.has(key)) bins.set(key, [])
        bins.get(key)!.push(c)
      }
  }
  copper.forEach(addToBins)
  function segmentLegal(
    a: TreePoint,
    b: TreePoint,
    z: number,
    radius: number,
    via = false,
  ): boolean {
    const edgeRadius = radius + problem.boardEdgeClearance + 1e-6
    if (
      !pointInOutline(a, problem.outline) ||
      !pointInOutline(b, problem.outline)
    )
      return false
    if (
      problem.outline.some(
        (p, i) =>
          minimumDistanceBetweenSegments(
            a,
            b,
            p,
            problem.outline[(i + 1) % problem.outline.length]!,
          ) < edgeRadius,
      )
    )
      return false
    const nearby = new Set<TreeCopper>()
    for (
      let x = Math.floor(Math.min(a.x, b.x) / binSize);
      x <= Math.floor(Math.max(a.x, b.x) / binSize);
      x++
    )
      for (
        let y = Math.floor(Math.min(a.y, b.y) / binSize);
        y <= Math.floor(Math.max(a.y, b.y) / binSize);
        y++
      )
        for (const c of bins.get(`${x},${y}`) ?? []) nearby.add(c)
    for (const c of nearby) {
      const drillDiameter = c.drill?.diameter ?? c.holeDiameter
      if (
        via &&
        drillDiameter &&
        (c.drill?.layers ?? c.layers).includes(z) &&
        minimumDistanceBetweenSegments(
          a,
          b,
          c.drill?.start ?? c.start,
          c.drill?.end ?? c.end,
        ) <
          (drillDiameter + problem.viaHoleDiameter) / 2 +
            (c.kind === "via"
              ? problem.holeClearance
              : (problem.platedHoleClearance ?? problem.holeClearance)) +
            1e-6
      )
        return false
      if (!c.layers.includes(z)) continue
      const physicalGap = segmentCopperGap(a, b, c)
      const envelopeGap = c.routingEnvelope
        ? segmentCopperGap(a, b, {
            ...c,
            start: {
              x: (c.start.x + c.end.x) / 2,
              y: (c.start.y + c.end.y) / 2,
            },
            rectangle: c.routingEnvelope,
            radius: 0,
          })
        : physicalGap
      if (
        c.owner !== problem.net &&
        Math.min(physicalGap, envelopeGap) <
          radius +
            (c.kind === "hole"
              ? via
                ? 0
                : (problem.traceToHoleClearance ?? problem.clearance)
              : via && c.kind === "pad"
                ? (problem.viaToPadClearance ?? problem.clearance)
                : problem.clearance) +
            1e-6
      )
        return false
      if (
        via &&
        !problem.allowViaInPad &&
        c.kind === "pad" &&
        Math.min(physicalGap, envelopeGap) < radius + 1e-6
      )
        return false
    }
    return true
  }
  const wireLegal = new Map<number, boolean>(),
    viaLegal = new Map<string, boolean>()
  function connectors(items: TreeCopper[]): Map<number, Connector> {
    const result = new Map<number, Connector>()
    for (const c of items) {
      const samples: TreePoint[] = []
      if (c.rectangle) {
        const corners = copperRectangleCorners(c)
        const x0 = Math.max(
            0,
            Math.floor(
              (Math.min(...corners.map((p) => p.x)) - bounds.minX) / h,
            ) - 1,
          ),
          x1 = Math.min(
            nx - 1,
            Math.ceil(
              (Math.max(...corners.map((p) => p.x)) - bounds.minX) / h,
            ) + 1,
          )
        const y0 = Math.max(
            0,
            Math.floor(
              (Math.min(...corners.map((p) => p.y)) - bounds.minY) / h,
            ) - 1,
          ),
          y1 = Math.min(
            ny - 1,
            Math.ceil(
              (Math.max(...corners.map((p) => p.y)) - bounds.minY) / h,
            ) + 1,
          )
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            samples.push({ x: bounds.minX + x * h, y: bounds.minY + y * h })
      } else {
        const count = Math.max(
          1,
          Math.ceil(Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y) / h),
        )
        for (let i = 0; i <= count; i++)
          samples.push({
            x: c.start.x + ((c.end.x - c.start.x) * i) / count,
            y: c.start.y + ((c.end.y - c.start.y) * i) / count,
          })
      }
      for (const sample of samples) {
        expansions++
        if (
          expansions > options.maxExpansions ||
          (expansions % 1024 === 0 && elapsed() > options.maxMilliseconds)
        )
          throw new RoutingRejection(
            "Dynamic net-tree connector budget exhausted",
          )
        const ix = Math.round((sample.x - bounds.minX) / h),
          iy = Math.round((sample.y - bounds.minY) / h)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const z of c.layers) {
              const x = ix + dx,
                y = iy + dy
              if (x < 0 || y < 0 || x >= nx || y >= ny) continue
              const cell = z * plane + y * nx + x,
                p = point(cell),
                projected = projectToCopper(p, c)
              const cost = Math.hypot(p.x - projected.x, p.y - projected.y)
              if (
                cost > h * 2 ||
                !segmentLegal(p, projected, z, problem.width / 2)
              )
                continue
              const old = result.get(cell)
              if (
                !old ||
                cost < old.cost - 1e-10 ||
                (Math.abs(cost - old.cost) < 1e-10 && c.id < old.copperId)
              )
                result.set(cell, {
                  point: projected,
                  copperId: c.id,
                  cost,
                  z,
                  path: [projected],
                })
            }
      }
    }
    return result
  }
  function search(
    sources: TreeCopper[],
    targets: TreeCopper[],
  ):
    | { path: GridPoint[]; source: Connector; target: Connector; cost: number }
    | undefined {
    searches++
    const seeds = connectors(sources),
      goals = connectors(targets)
    if (seeds.size === 0 || goals.size === 0) return undefined
    // Bounds to target copper are admissible; obstacles remain hard geometry.
    const boxes = targets.map((c) => {
      const ps = c.rectangle ? copperRectangleCorners(c) : [c.start, c.end]
      return {
        minX: Math.min(...ps.map((p) => p.x)),
        maxX: Math.max(...ps.map((p) => p.x)),
        minY: Math.min(...ps.map((p) => p.y)),
        maxY: Math.max(...ps.map((p) => p.y)),
        layers: c.layers,
      }
    })
    function heuristic(cell: number): number {
      const p = point(cell)
      return Math.min(
        ...boxes.map(
          (b) =>
            Math.hypot(
              Math.max(b.minX - p.x, 0, p.x - b.maxX),
              Math.max(b.minY - p.y, 0, p.y - b.maxY),
            ) + (b.layers.includes(p.z) ? 0 : options.viaCost),
        ),
      )
    }
    const boundedVias =
      options.maxViasPerBranch !== undefined ||
      options.maxViasPerNet !== undefined
    const viaBudget = boundedVias
      ? Math.min(
          options.maxViasPerBranch ?? 32,
          (options.maxViasPerNet ?? 32) - insertedVias,
        )
      : 0
    if (viaBudget < 0)
      throw new Error("Net via budget exceeded during insertion")
    const stateCount = cellCount * 9 * (viaBudget + 1)
    if (stateCount > 40_000_000)
      throw new RoutingRejection("Via-budget state memory cap exceeded")
    const distance = new Float64Array(stateCount).fill(Infinity),
      parent = new Int32Array(stateCount).fill(-2),
      seedFor = new Map<number, Connector>(),
      queue = new TreeSearchHeap()
    for (const [cell, seed] of seeds) {
      const state = cell * 9 + 8
      distance[state] = seed.cost
      parent[state] = -1
      seedFor.set(state, seed)
      queue.push({
        state,
        cost: seed.cost,
        priority: seed.cost + heuristic(cell),
      })
    }
    let best = Infinity,
      bestState = -1,
      bestTarget: Connector | undefined
    while (true) {
      const entry = queue.pop()
      if (!entry || entry.priority >= best - 1e-10) break
      if (entry.cost !== distance[entry.state]) continue
      expansions++
      if (
        expansions > options.maxExpansions ||
        (expansions % 1024 === 0 && elapsed() > options.maxMilliseconds)
      )
        throw new RoutingRejection("Dynamic net-tree search budget exhausted")
      const cell = Math.floor(entry.state / 9) % cellCount,
        usedVias = Math.floor(entry.state / (cellCount * 9)),
        heading = entry.state % 9,
        p = point(cell),
        goal = goals.get(cell)
      if (goal && entry.cost + goal.cost < best) {
        best = entry.cost + goal.cost
        bestState = entry.state
        bestTarget = goal
      }
      for (
        let direction = 0;
        direction < 8 + problem.layerCount - 1;
        direction++
      ) {
        let nextCell: number, cost: number
        if (direction >= 8) {
          if (boundedVias && usedVias >= viaBudget) continue
          const xyCell = cell % plane
          const targetIndex = direction - 8
          const targetZ = targetIndex >= p.z ? targetIndex + 1 : targetIndex
          const minZ = problem.allowBlindAndBuriedVias ? Math.min(p.z, targetZ) : 0
          const maxZ = problem.allowBlindAndBuriedVias
            ? Math.max(p.z, targetZ)
            : problem.layerCount - 1
          const key = `${xyCell}:${minZ}:${maxZ}`
          let legal = viaLegal.get(key)
          if (legal === undefined) {
            legal = Array.from(
              { length: maxZ - minZ + 1 },
              (_, i) => minZ + i,
            ).every((z) => segmentLegal(p, p, z, problem.viaDiameter / 2, true))
            viaLegal.set(key, legal)
          }
          if (!legal) continue
          nextCell = targetZ * plane + xyCell
          cost = options.viaCost
        } else {
          const [dx, dy] = directions[direction]!,
            x = (cell % nx) + dx,
            y = Math.floor((cell % plane) / nx) + dy
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue
          nextCell = p.z * plane + y * nx + x
          const edgeKey = cell * 8 + direction
          let legal = wireLegal.get(edgeKey)
          if (legal === undefined) {
            legal = segmentLegal(p, point(nextCell), p.z, problem.width / 2)
            wireLegal.set(edgeKey, legal)
          }
          if (!legal) continue
          cost =
            h * (dx && dy ? Math.SQRT2 : 1) +
            (heading !== 8 && heading !== direction ? options.bendCost : 0)
        }
        const nextUsedVias =
          boundedVias && direction >= 8 ? usedVias + 1 : usedVias
        const state =
            (nextUsedVias * cellCount + nextCell) * 9 + Math.min(direction, 8),
          candidate = entry.cost + cost
        if (candidate < distance[state]! - 1e-10) {
          distance[state] = candidate
          parent[state] = entry.state
          queue.push({
            state,
            cost: candidate,
            priority: candidate + heuristic(nextCell),
          })
        }
      }
    }
    if (bestState < 0 || !bestTarget) return undefined
    const path: GridPoint[] = [],
      visited = new Set<number>()
    let state = bestState
    while (parent[state] !== -1) {
      if (visited.has(state)) throw new Error("Search predecessor cycle")
      visited.add(state)
      path.push(point(Math.floor(state / 9) % cellCount))
      state = parent[state]!
    }
    path.push(point(Math.floor(state / 9) % cellCount))
    path.reverse()
    const source = seedFor.get(state)
    if (!source) throw new Error("Missing physical search source")
    return {
      path: [
        ...source.path.map((p) => ({ ...p, z: source.z })),
        ...path,
        ...[...bestTarget.path]
          .reverse()
          .map((p) => ({ ...p, z: bestTarget.z })),
      ],
      source,
      target: bestTarget,
      cost: best,
    }
  }
  function physicalViaLayers(from: number, to: number): number[] {
    const min = problem.allowBlindAndBuriedVias ? Math.min(from, to) : 0
    const max = problem.allowBlindAndBuriedVias
      ? Math.max(from, to)
      : problem.layerCount - 1
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }
  function insert(found: NonNullable<ReturnType<typeof search>>): void {
    const branchId = `dynamic:${problem.net}:${traces.length}`,
      route: SimplifiedPcbTrace["route"] = []
    const pts = found.path.filter(
      (p, i, a) =>
        i === 0 ||
        p.z !== a[i - 1]!.z ||
        Math.hypot(p.x - a[i - 1]!.x, p.y - a[i - 1]!.y) > 1e-9,
    )
    const collapsed = pts.filter((p, i) => {
      if (i === 0 || i === pts.length - 1) return true
      const a = pts[i - 1]!,
        b = pts[i + 1]!
      return (
        p.z !== a.z ||
        p.z !== b.z ||
        Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) >
          1e-9 ||
        (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y) <= 0
      )
    })
    for (let i = 0; i < collapsed.length; i++) {
      const p = collapsed[i]!,
        previous = collapsed[i - 1]
      if (previous && previous.z !== p.z) insertedVias++
      if (previous && previous.z !== p.z)
        route.push({
          route_type: "via",
          x: p.x,
          y: p.y,
          from_layer: mapZToLayerName(previous.z, problem.layerCount),
          to_layer: mapZToLayerName(p.z, problem.layerCount),
          layers: physicalViaLayers(previous.z, p.z).map((z) =>
            mapZToLayerName(z, problem.layerCount),
          ),
          via_diameter: problem.viaDiameter,
          via_hole_diameter: problem.viaHoleDiameter,
        })
      route.push({
        route_type: "wire",
        x: p.x,
        y: p.y,
        layer: mapZToLayerName(p.z, problem.layerCount),
        width: problem.width,
      })
      if (!previous) continue
      const c: TreeCopper = {
        id: `${branchId}:${i}`,
        owner: problem.net,
        kind: previous.z === p.z ? "wire" : "via",
        layers: previous.z === p.z ? [p.z] : physicalViaLayers(previous.z, p.z),
        start: previous,
        end: p,
        radius:
          previous.z === p.z ? problem.width / 2 : problem.viaDiameter / 2,
        ...(previous.z === p.z
          ? {}
          : {
              holeDiameter: problem.viaHoleDiameter,
              drill: {
                start: p,
                end: p,
                diameter: problem.viaHoleDiameter,
                layers: physicalViaLayers(previous.z, p.z),
              },
            }),
      }
      copper.push(c)
      addToBins(c)
      // New same-net wires do not alter wire legality; new via holes do.
      if (c.kind === "via") viaLegal.clear()
    }
    // Insert branch coordinates into mutable owned route centerlines. Fixed
    // input copper remains byte-identical; the attachment record splits its
    // topology logically without rewriting it.
    for (const trace of traces)
      for (let i = trace.route.length - 2; i >= 0; i--) {
        const a = trace.route[i]!,
          b = trace.route[i + 1]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer ||
          a.layer !== mapZToLayerName(found.source.z, problem.layerCount)
        )
          continue
        const p = found.source.point,
          gap = minimumDistanceBetweenSegments(p, p, a, b)
        if (
          gap < 1e-8 &&
          Math.hypot(p.x - a.x, p.y - a.y) > 1e-8 &&
          Math.hypot(p.x - b.x, p.y - b.y) > 1e-8
        )
          trace.route.splice(i + 1, 0, { ...a, x: p.x, y: p.y })
      }
    traces.push({
      type: "pcb_trace",
      pcb_trace_id: branchId,
      connection_name: problem.net,
      route,
    })
    attachments.push({
      branchId,
      sourceCopperId: found.source.copperId,
      targetCopperId: found.target.copperId,
      source: found.source.point,
      sourceLayer: found.source.z,
      cost: found.cost,
    })
  }
  function commitBranch(found: NonNullable<ReturnType<typeof search>>): void {
    const before: number = components().length
    insert(found)
    const joined: TreeCopper[][] = components()
    if (joined.length >= before)
      throw new Error("Branch insertion failed to join physical components")
  }
  function progress(
    kind: DynamicNetTreeProgress["kind"],
  ): DynamicNetTreeProgress {
    return {
      kind,
      net: problem.net,
      traces: structuredClone(traces),
      branches: traces.length,
      components: components().length,
      initialComponents,
      insertedVias,
      expansions,
    }
  }
  let failure: string | undefined
  try {
    if (!Number.isSafeInteger(cellCount) || cellCount > 1_000_000)
      throw new RoutingRejection(`Grid budget exceeded: ${cellCount} cells`)
    {
      if (options.componentPlanning === "zero-via-forest") {
        const initial: TreeCopper[][] = components()
        const joins = findZeroViaCopperForest(
          { nx, ny, step: h, point, layerCount: problem.layerCount },
          initial.map(
            (group: TreeCopper[]): Map<number, Connector> => connectors(group),
          ),
          (cell: number, direction: number): boolean => {
            const [dx, dy] = directions[direction]!,
              x: number = (cell % nx) + dx,
              y: number = Math.floor((cell % plane) / nx) + dy
            const next: number = Math.floor(cell / plane) * plane + y * nx + x,
              key: number = cell * 8 + direction
            let legal: boolean | undefined = wireLegal.get(key)
            if (legal === undefined) {
              legal = segmentLegal(
                point(cell),
                point(next),
                Math.floor(cell / plane),
                problem.width / 2,
              )
              wireLegal.set(key, legal)
              wireLegal.set(next * 8 + ((direction + 4) % 8), legal)
            }
            return legal
          },
          (): void => {
            expansions++
            zeroViaForestExpansions++
            if (
              expansions > options.maxExpansions ||
              (expansions % 1024 === 0 && elapsed() > options.maxMilliseconds)
            )
              throw new RoutingRejection(
                "Dynamic net-tree zero-via forest budget exhausted",
              )
          },
        )
        for (const join of joins) {
          const current: TreeCopper[][] = components()
          const source = current.find((group: TreeCopper[]): boolean =>
            group.some(
              (c: TreeCopper): boolean => c.id === join.source.copperId,
            ),
          )
          const target = current.find((group: TreeCopper[]): boolean =>
            group.some(
              (c: TreeCopper): boolean => c.id === join.target.copperId,
            ),
          )
          if (!source || !target)
            throw new Error("Lost physical forest component")
          if (source === target) continue
          commitBranch(join)
          zeroViaForestJoins++
          const paused = performance.now()
          yield progress("forest")
          pausedMilliseconds += performance.now() - paused
        }
      }
      while (true) {
        const groups = components(),
          active = groups.find((g) => g.some((c) => c.id === rootId))
        if (!active) throw new Error("Lost physical root component")
        // Every fixed same-net island is kept and connected, including islands
        // without a terminal. New search targets are recalculated after insert.
        const remaining = groups.filter((g) => g !== active)
        if (remaining.length === 0) break
        const found = search(active, remaining.flat())
        if (!found) {
          const missing = problem.terminals
            .filter((t) =>
              remaining.some((g) =>
                g.some((c) => terminalCopperIds.get(t.id)!.has(c.id)),
              ),
            )
            .map((t) => t.id)
          throw new RoutingRejection(
            `No physically reachable component for ${problem.net}; remaining terminals: ${missing.join(",")}`,
          )
        }
        commitBranch(found)
        const paused = performance.now()
        yield progress("tree")
        pausedMilliseconds += performance.now() - paused
      }
    }
  } catch (error) {
    if (!(error instanceof RoutingRejection)) throw error
    failure = error.message
  }
  const stats = {
    zeroViaForestExpansions,
    zeroViaForestJoins,
    insertedVias,
    rootCopperId: rootId,
    expansions,
    searches,
    branches: traces.length,
    elapsedMs: elapsed(),
    initialComponents,
    finalComponents: components().length,
  }
  return failure
    ? { solved: false, error: failure, traces: [], attachments: [], stats }
    : { solved: true, traces, attachments, stats }
}

/** Synchronous entry point; uses the same search as the incremental solver. */
export function routeDynamicNetTree(
  problem: DynamicNetTreeProblem,
  options: DynamicNetTreeOptions,
): DynamicNetTreeResult {
  const steps = routeDynamicNetTreeSteps(problem, options)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

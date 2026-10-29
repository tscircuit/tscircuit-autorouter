import { FindClearancePathSolver } from "@tscircuit/repair04"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { IntraNodeRouteSolver } from "./IntraNodeSolver"
import { PathPackingGeometry, preparePathPackingObstacles, type PackingTask, type PathPackingAudit } from "./pathPackingGeometry"
import { selectPackedPaths } from "./selectPackedPaths"
import { precomputeIntraNodeRouteParams } from "./precomputeIntraNodeRouteParams"

type Params = ConstructorParameters<typeof IntraNodeRouteSolver>[0] & {
  pathPackingStats: PathPackingAudit
  boardGeometry?: import("lib/types/high-density-board-geometry").HighDensityBoardGeometry
  pathPackingHoleClearance?: number
  pathPackingViaToPadClearance?: number
  pathPackingMaxWork?: number
}

/** Independently generate full geometric choices, then select a mutually legal complete set. */
export class PathPackingIntraNodeSolver extends IntraNodeRouteSolver {
  private readonly run: Generator<void, void>
  readonly pathPackingStats: PathPackingAudit
  readonly params: Params
  private terminalRecorded = false

  static hasSmallDomain(node: Params["nodeWithPortPoints"]): boolean {
    if (node.portPoints.length > 48 || node.portPoints.length < 4) return false
    const names = new Set(node.portPoints.map((p) => p.connectionName))
    return names.size >= 2 && names.size <= 6
  }

  static isApplicable(params: Params): boolean {
    if (!PathPackingIntraNodeSolver.hasSmallDomain(params.nodeWithPortPoints)) return false
    const precomputed = params.precomputedIntraNodeRouteParams ?? precomputeIntraNodeRouteParams(params.nodeWithPortPoints)
    const groups = precomputed.connectionPointsByName
    if (groups.size < 2 || groups.size > 6 || [...groups.values()].some((points) => points.length !== 2)) return false
    const names = [...groups.keys()]
    for (let i = 0; i < names.length; i++) for (let j = 0; j < i; j++) {
      const a = precomputed.rootConnectionNameByConnectionName.get(names[i]!)
      const b = precomputed.rootConnectionNameByConnectionName.get(names[j]!)
      if ((a !== undefined && a === b) || params.connMap?.areIdsConnected(names[i]!, names[j]!) === true) return false
    }
    return (params.priorityCoordinateScale ?? 1) === 1 &&
      (params.layerCount ?? 2) <= 8 &&
      params.nodeWithPortPoints.width > 2 * (params.viaDiameter ?? 0.3) &&
      params.nodeWithPortPoints.height > 2 * (params.viaDiameter ?? 0.3)
  }

  constructor(params: Params) {
    super(params)
    this.params = params
    this.pathPackingStats = params.pathPackingStats
    this.pathPackingStats.instances++
    this.MAX_ITERATIONS = params.pathPackingMaxWork ?? 96_000
    if (!Number.isSafeInteger(this.MAX_ITERATIONS) || this.MAX_ITERATIONS < 1)
      throw new Error("Invalid path packing aggregate budget")
    this.run = this.pack()
  }

  private finishUnknown(reason: string): void {
    this.failed = true
    this.error = `Bounded path packing exhausted: ${reason}`
    if (!this.terminalRecorded) {
      this.pathPackingStats.exhaustedNodes++
      this.terminalRecorded = true
    }
  }

  private makeRoute(task: PackingTask, points: HighDensityRoute["route"]): HighDensityRoute {
    const compact: HighDensityRoute["route"] = []
    for (const p of points) {
      const previous = compact.at(-1)
      if (previous && previous.x === p.x && previous.y === p.y && previous.z === p.z) continue
      compact.push({ ...p })
      while (compact.length >= 3) {
        const a = compact[compact.length - 3]!, b = compact[compact.length - 2]!, c = compact.at(-1)!
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
        if (a.z !== b.z || b.z !== c.z || Math.abs(cross) > 1e-12 ||
          (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) break
        compact.splice(compact.length - 2, 1)
      }
    }
    const vias: HighDensityRoute["vias"] = []
    for (let i = 1; i < compact.length; i++) {
      if (compact[i - 1]!.z !== compact[i]!.z) vias.push({ x: compact[i]!.x, y: compact[i]!.y })
    }
    return { connectionName: task.connectionName, rootConnectionName: task.rootConnectionName,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId, traceThickness: this.traceWidth,
      viaDiameter: this.viaDiameter, route: compact, vias }
  }

  private *pack(): Generator<void, void> {
    const audit = this.pathPackingStats
    if (!PathPackingIntraNodeSolver.isApplicable(this.params)) {
      this.finishUnknown("outside finite two-terminal small-region domain")
      return
    }
    audit.eligibleNodes++
    const tasks = this.unsolvedConnections.map((task): PackingTask => {
      if (task.points.length !== 2) throw new Error("Packing eligibility and native terminal decomposition disagree")
      return { connectionName: task.connectionName, rootConnectionName: task.rootConnectionName,
        points: [{ ...task.points[0]! }, { ...task.points[1]! }] }
    })
    const node = this.nodeWithPortPoints
    const bounds = getBoundsFromNodeWithPortPoints(node)
    const layerCount = this.params.layerCount ?? 2
    const allowed = node.availableZ ?? Array.from({ length: layerCount }, (_, i) => i)
    if (allowed.some((z) => !Number.isSafeInteger(z) || z < 0 || z >= layerCount))
      throw new Error("Invalid path packing layer domain")
    const holeClearance = this.params.pathPackingHoleClearance ?? this.obstacleMargin
    const viaPadClearance = this.params.pathPackingViaToPadClearance ?? this.obstacleMargin
    const minimumHoleGap = this.params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    const obstacles = yield* preparePathPackingObstacles(node, this.params.obstacles ?? [], this.traceWidth,
      this.viaDiameter, Math.max(this.obstacleMargin, holeClearance, viaPadClearance))
    const geometry = new PathPackingGeometry({ node, obstacles, connMap: this.connMap,
      boardGeometry: this.params.boardGeometry, layerCount,
      allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      traceClearance: this.obstacleMargin,
      viaToPadClearance: viaPadClearance,
      holeClearance,
      viaHoleDiameter: this.params.viaHoleDiameter ?? this.viaDiameter,
      minimumHoleGap,
    }, audit)
    const banks: HighDensityRoute[][] = []
    for (const task of tasks) {
      audit.bankTasks++
      const bank: HighDensityRoute[] = [], keys = new Set<string>(), viaKeys = new Set<string>()
      const add = function* (route: HighDensityRoute, native = false): Generator<void, void> {
        audit.generatedCandidates++
        yield
        if (route.route.length > 256 || !(yield* geometry.unary(route, task))) return
        // Deduplicate physical polylines rather than raw point subdivision.
        // Quantization only removes near-identical alternatives; original
        // coordinates still undergo complete continuous geometry validation.
        const key = JSON.stringify(route.route.map((p) => [Math.round(p.x * 1e9), Math.round(p.y * 1e9), p.z]))
        if (keys.has(key)) return
        keys.add(key)
        const viaKey = JSON.stringify(route.route.flatMap((p, i) => i > 0 && route.route[i - 1]!.z !== p.z
          ? [[p.x, p.y, route.route[i - 1]!.z, p.z]] : []))
        if (!viaKeys.has(viaKey)) { viaKeys.add(viaKey); audit.distinctViaPatterns++ }
        for (const point of route.route) { yield; Object.freeze(point) }
        Object.freeze(route.route); Object.freeze(route.vias); Object.freeze(route)
        bank.push(route)
        audit.distinctCandidates++
        if (native) audit.nativeDistinctCandidates++
      }
      const [a, b] = task.points
      const inset = Math.max(this.viaDiameter / 2, this.traceWidth / 2) + this.obstacleMargin
      const lead = (p: typeof a): typeof a => ({ ...p,
        x: Math.max(bounds.minX + inset, Math.min(bounds.maxX - inset, p.x)),
        y: Math.max(bounds.minY + inset, Math.min(bounds.maxY - inset, p.y)) })
      const start = lead(a), end = lead(b)
      // Native searches see fixed board geometry, never another banked net.
      // Opposite intermediate anchors create genuinely different native paths.
      for (let attempt = 0; attempt < 3 && bank.length < 8; attempt++) {
        const horizontal = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)
        const waypoint = { x: node.center.x + (horizontal ? 0 : attempt === 1 ? 0.2 : -0.2) * node.width,
          y: node.center.y + (horizontal ? attempt === 1 ? 0.2 : -0.2 : 0) * node.height, z: a.z }
        const anchors = attempt === 0 ? [a, b] : [a, waypoint, b]
        const complete: HighDensityRoute["route"] = []
        let found = true
        for (let leg = 1; leg < anchors.length; leg++) {
        yield
        const setupBound = 64 + obstacles.length * (layerCount + tasks.length + 4) + tasks.length * 8
        if (this.MAX_ITERATIONS - this.iterations <= setupBound + 512) { found = false; break }
        for (let work = 0; work < setupBound; work++) yield
        const seed = this.makeRoute(task, [a, b])
        const generationStop = Math.min(this.MAX_ITERATIONS - 256, this.iterations + 3000)
        const search = new FindClearancePathSolver({
          srj: { layerCount, minTraceWidth: this.traceWidth, minViaDiameter: this.viaDiameter,
            bounds: this.params.boardGeometry?.bounds ?? bounds, obstacles: obstacles.map((o) => ({ ...o,
              connectedTo: [...o.connectedTo, ...tasks.filter((t) => o.connectedTo.some((id) => id === t.connectionName || this.connMap?.areIdsConnected(id, t.connectionName))).map((t) => t.connectionName)] })),
            connections: tasks.map((t) => ({ name: t.connectionName, rootConnectionName: t.rootConnectionName,
              pointsToConnect: t.points.map((p) => ({ x: p.x, y: p.y, layer: mapZToLayerName(p.z, layerCount) })) })),
            minTraceToPadEdgeClearance: this.obstacleMargin,
            minTraceToHoleEdgeClearance: holeClearance,
            minViaEdgeToPadEdgeClearance: viaPadClearance,
            allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias },
          routes: [seed], routeIndex: 0, start: anchors[leg - 1]!, end: anchors[leg]!, bounds,
          traceThickness: this.traceWidth, traceClearance: this.obstacleMargin,
          // Native repair04 shares this parameter between copper and drill
          // spacing. Use the stricter requirement; final checks keep both rules.
          viaClearance: Math.max(this.obstacleMargin, minimumHoleGap),
          viaHoleDiameter: this.params.viaHoleDiameter ?? this.viaDiameter,
          maxNodes: Math.max(1, Math.min(1024, Math.floor((this.MAX_ITERATIONS - this.iterations - 256) / 2))),
          gridSize: Math.max(0.05, this.traceWidth / 2), allowLayerChanges: allowed.length > 1,
          getAdditionalEdgeCost: (left, right): number => {
            if (!allowed.includes(left.z) || !allowed.includes(right.z)) return Infinity
            return 0
          },
        })
        while (!search.solved && !search.failed) {
          if (this.iterations + 256 >= generationStop) break
          const before = search.stats.nodesPopped
          search.step()
          const pops = search.stats.nodesPopped - before
          audit.generationSearchNodes += pops
          // One parent dispatch pays setup; additional actual heap pops are
          // charged to the same aggregate supervisor work clock.
          this.iterations += pops
          audit.workUnits += pops
          yield
          if (this.iterations >= this.MAX_ITERATIONS) { this.finishUnknown("generation work limit"); return }
        }
        if (search.failed) throw new Error(`Path packing candidate search failed: ${search.error}`)
        if (!search.solved) { found = false; break }
        const path = search.getOutput()
        if (!path) { found = false; break }
        complete.push(...(leg === 1 ? path : path.slice(1)))
        }
        if (found) yield* add(this.makeRoute(task, complete), true)
      }
      // Interleave layers with distinct XY corridors; these are not route orders
      // or fixed-XY relabels of a previously solved complete board.
      for (let style = 0; style < 8 && bank.length < 8; style++) {
        for (const z of allowed) {
          yield
          if (bank.length >= 8) break
          const middle: HighDensityRoute["route"] = []
          if (style === 1) middle.push({ x: start.x, y: end.y, z })
          if (style === 2) middle.push({ x: end.x, y: start.y, z })
          if (style === 3 || style === 4 || style === 5) {
            const x = node.center.x + (style - 4) * node.width * 0.2
            middle.push({ x, y: start.y, z }, { x, y: end.y, z })
          }
          if (style === 6 || style === 7) {
            const y = node.center.y + (style === 6 ? -0.2 : 0.2) * node.height
            middle.push({ x: start.x, y, z }, { x: end.x, y, z })
          }
          yield* add(this.makeRoute(task, [a, start, { ...start, z }, ...middle, { ...end, z }, end, b]))
        }
      }
      if (bank.length === 0) { this.finishUnknown("no validated candidate for a task"); return }
      banks.push(bank)
      this.progress = Math.min(0.85, banks.length / tasks.length * 0.85)
    }
    const selected = yield* selectPackedPaths(banks, geometry)
    if (!selected) { this.finishUnknown("no compatible assignment in finite bank/state budget"); return }
    // Recheck the complete owned assignment before publishing any member.
    for (let i = 0; i < selected.length; i++) {
      if (!(yield* geometry.unary(selected[i]!, tasks[i]!))) throw new Error("Packing unary validation changed without an input mutation")
      for (let j = 0; j < i; j++)
        if (yield* geometry.conflict(selected[i]!, selected[j]!)) throw new Error("Packing selector returned conflicting paths")
    }
    this.solvedRoutes = structuredClone(selected)
    this.solved = true
    this.progress = 1
    this.terminalRecorded = true
    audit.solvedNodes++
  }

  override _step(): void {
    this.pathPackingStats.activated = true
    this.pathPackingStats.workUnits++
    if (this.iterations >= this.MAX_ITERATIONS) { this.finishUnknown("aggregate work limit"); return }
    const result = this.run.next()
    if (!this.solved && !this.failed && this.iterations >= this.MAX_ITERATIONS)
      this.finishUnknown("aggregate work limit")
    if (result.done && !this.solved && !this.failed) throw new Error("Path packing terminated without an explicit outcome")
  }
}

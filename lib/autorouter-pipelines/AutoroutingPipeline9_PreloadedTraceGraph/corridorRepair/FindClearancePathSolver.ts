// Experimental constrained-mesh search; hard geometry and stepping contracts copied from pinned repair04.
import type {
  ClearancePathInput,
  ClearancePathSearchStats,
} from "./findClearancePath"
import { BaseSolver } from "@tscircuit/solver-utils"
import { createMeshCorridorSearch } from "./createMeshCorridorSearch"
import type { MeshCorridorPathInput } from "./buildConstrainedCorridorMesh"
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

type ClearancePathPhase =
  | "initialize"
  | "obstacles"
  | "routes"
  | "traces"
  | "index"
  | "seed"
  | "search"
  | "finished"

/** Native hard-geometry preparation with a finite constrained-mesh path policy. */
export class FindClearancePathSolver extends BaseSolver {
  readonly input: MeshCorridorPathInput
  override stats: ClearancePathSearchStats
  private phase: ClearancePathPhase = "initialize"
  private cursor = 0
  private barrierCount = 0
  private output: Point[] | null | undefined
  private prepareObstacle?: (
    obstacle: ClearancePathInput["srj"]["obstacles"][number],
  ) => void
  private prepareRoute?: (route: HighDensityRoute) => void
  private prepareTrace?: (
    trace: NonNullable<ClearancePathInput["srj"]["traces"]>[number],
  ) => void
  private indexBarrier?: (index: number) => void
  private seedSearch?: () => void
  private searchBatch?: () => void

  constructor(input: MeshCorridorPathInput) {
    super()
    this.input = input
    this.stats = input.stats ?? { nodesPopped: 0, completionReason: "no-path" }
    this.MAX_ITERATIONS =
      Math.ceil((input.maxNodes ?? 30000) / 32) +
      Math.ceil(input.srj.obstacles.length / 128) +
      Math.ceil(input.routes.length / 32) +
      Math.ceil((input.srj.traces?.length ?? 0) / 32) +
      input.srj.obstacles.length * input.srj.layerCount +
      input.routes.reduce((count, route) => count + route.route.length, 0) +
      (input.srj.traces ?? []).reduce(
        (count, trace) => count + trace.route.length,
        0,
      ) +
      32
  }

  private finish(output: Point[] | null): void {
    this.output = output
    this.phase = "finished"
    this.solved = true
    this.progress = 1
    // Completed searches retain their output and accounting, not heap caches.
    this.prepareObstacle = undefined
    this.prepareRoute = undefined
    this.prepareTrace = undefined
    this.indexBarrier = undefined
    this.seedSearch = undefined
    this.searchBatch = undefined
  }

  override _step(): void {
    if (this.phase === "initialize") {
      this.initialize()
      return
    }
    if (this.phase === "seed") {
      this.seedSearch!()
      return
    }
    if (this.phase === "search") {
      this.searchBatch!()
      if (!this.solved)
        this.progress = Math.min(
          0.99,
          this.stats.nodesPopped / (this.input.maxNodes ?? 30000),
        )
      return
    }
    const start = this.cursor
    if (this.phase === "obstacles") {
      const obstacles = this.input.srj.obstacles
      for (
        ;
        this.cursor < Math.min(start + 128, obstacles.length);
        this.cursor++
      ) {
        this.prepareObstacle!(obstacles[this.cursor]!)
      }
      if (this.cursor === obstacles.length) {
        this.phase = "routes"
        this.cursor = 0
      }
      return
    }
    if (this.phase === "routes") {
      for (
        ;
        this.cursor < Math.min(start + 32, this.input.routes.length);
        this.cursor++
      ) {
        this.prepareRoute!(this.input.routes[this.cursor]!)
      }
      if (this.cursor === this.input.routes.length) {
        this.phase = "traces"
        this.cursor = 0
      }
      return
    }
    if (this.phase === "traces") {
      const traces = this.input.srj.traces ?? []
      for (; this.cursor < Math.min(start + 32, traces.length); this.cursor++) {
        this.prepareTrace!(traces[this.cursor]!)
      }
      if (this.cursor === traces.length) {
        this.phase = "index"
        this.cursor = 0
      }
      return
    }
    if (this.phase === "index") {
      for (
        ;
        this.cursor < Math.min(start + 128, this.barrierCount);
        this.cursor++
      ) {
        this.indexBarrier!(this.cursor)
      }
      if (this.cursor === this.barrierCount) this.phase = "seed"
      return
    }
    throw new Error("repair04: clearance path stepped after completion")
  }

  private initialize(): void {
    const input = this.input
    const { srj, routes, routeIndex, start, end, bounds, traceThickness } =
      input
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
    if (this.stats) {
      this.stats.nodesPopped = 0
      this.stats.completionReason = "no-path"
    }
    if (input.allowLayerChanges === false && start.z !== end.z) {
      this.finish(null)
      return
    }
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
        ...connection.pointsToConnect.flatMap((p) => [
          p.pcb_port_id,
          p.pointId,
        ]),
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

    this.prepareObstacle = (obstacle): void => {
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

      this.barrierCount = barriers.length
    }
    this.prepareRoute = (other): void => {
      if (net(other.connectionName) === owner) return
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

      this.barrierCount = barriers.length
    }
    this.prepareTrace = (raw): void => {
      if (net(raw.connection_name) === owner) return
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

      this.barrierCount = barriers.length
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

    this.indexBarrier = (index): void => {
      const barrier = barriers[index]!

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
      for (
        let x = Math.floor(minX - reach);
        x <= Math.floor(maxX + reach);
        x++
      ) {
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

    this.seedSearch = (): void => {
      if (
        !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) ||
        !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY) ||
        !(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)
      ) throw new Error("Mesh corridor requires nondegenerate finite bounds")
      if (!clear(start, start) || !clear(end, end)) {
        this.finish(null)
        return
      }
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
                clear(path[index]!, point) &&
                extraCost(path[index]!, point) === 0,
            )
        ) {
          if (this.stats) this.stats.completionReason = "found"
          this.finish(path.map((point): Point => ({ ...point })))
          return
        }
      }
      // As with the existing-path witness above, a direct physical zero-price
      // segment needs no heap exploration. Every route has at least its planar
      // Euclidean length and all additional prices/via costs are nonnegative.
      // The maxNodes allowance counts actual heap pops, not analytic witnesses.
      const meshStats = this.stats as ClearancePathSearchStats & Record<string, number | string>
      meshStats.meshStraightWitnessChecks = 0
      meshStats.meshStraightWitnessPriceChecks = 0
      meshStats.meshStraightWitnessAccepted = 0
      if (start.z === end.z) {
        meshStats.meshStraightWitnessChecks = 1
        if (clear(start, end)) {
          meshStats.meshStraightWitnessPriceChecks = 1
          if (extraCost(start, end) === 0) {
            meshStats.meshStraightWitnessAccepted = 1
            meshStats.corridorEdgeChecks = 1
            this.stats.completionReason = "found"
            this.finish([{ ...start }, { ...end }])
            return
          }
        }
      }
      const search = createMeshCorridorSearch({
        input,
        barriers,
        clear,
        extraCost,
        clearsDrills,
        stats: this.stats,
      })
      // The mesh initializes its own native-edge counter during construction.
      // Retain the additional failed straight-witness query in that total too.
      meshStats.corridorEdgeChecks =
        (typeof meshStats.corridorEdgeChecks === "number" ? meshStats.corridorEdgeChecks : 0) +
        meshStats.meshStraightWitnessChecks
      this.searchBatch = (): void => {
        const result = search.step()
        if (result.status === "pending") return
        if (result.path && !pathClearsDrills(result.path)) {
          throw new Error("Corridor search generated conflicting drill sites")
        }
        this.stats.completionReason = result.reason
        this.finish(result.path)
      }
      this.phase = "search"
    }
    this.phase = "obstacles"
  }

  override getOutput(): Point[] | null {
    if (!this.solved || this.failed || this.output === undefined) {
      throw new Error(
        "repair04: clearance path output requested before completion",
      )
    }
    return this.output
  }

  getResult(): Point[] | null {
    return this.getOutput()
  }
}

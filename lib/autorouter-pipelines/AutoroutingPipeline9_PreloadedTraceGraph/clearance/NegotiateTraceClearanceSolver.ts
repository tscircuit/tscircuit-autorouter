// Derived from tscircuit/repair04@4273e9455084b7b35ebc860ebe4483b9d19692ea (MIT).
import { getRepairRouteVias } from "./getRepairRouteVias"
import type {
  NegotiatedClearanceInput,
  NegotiatedClearanceResult,
} from "@tscircuit/repair04"
import { BaseSolver } from "@tscircuit/solver-utils"
import { FindClearancePathSolver } from "./FindClearancePathSolver"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import Flatbush from "flatbush"
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { type ClearancePathSearchStats } from "@tscircuit/repair04"
import { getNetRepresentatives } from "./getNetRepresentatives"
import { getRepairCopperLayerSpan } from "./getRepairCopperLayerSpan"
import { REGION_EPSILON } from "./repairRegionGeometry"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { getClearanceCapsuleSupportOrientation, mergeClearanceCorridorStats, type ClearanceCostSupport } from "./createClearanceCorridorSearch"

type Span = {
  routeIndex: number
  mutable: boolean
  route: HighDensityRoute
}
type Copper = {
  a: RepairRoutePoint
  b: RepairRoutePoint
  radius: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  spanIndex: number
  owner: string
  index: number
  cellX: number
  cellY: number
  immutable: boolean
}
function withPoints({
  route,
  points,
  mutableBounds,
}: {
  route: HighDensityRoute
  points: RepairRoutePoint[]
  mutableBounds: Bounds
}): HighDensityRoute {
  const updatedRoute = { ...route, route: points }
  return {
    ...updatedRoute,
    vias: getRepairRouteVias({ route: updatedRoute, mutableBounds }),
  }
}

type NegotiationPhase =
  | "initialize"
  | "spans"
  | "setup"
  | "select"
  | "coppers"
  | "start-path"
  | "path"
  | "apply-path"
  | "finished"

/** Negotiates span space while exposing each bounded A* search as a child solver. */
export class NegotiateTraceClearanceSolver extends BaseSolver {
  readonly input: NegotiatedClearanceInput
  private phase: NegotiationPhase = "initialize"
  private routeCursor = 0
  private copperCursor = 0
  private spanCount = 0
  private output?: NegotiatedClearanceResult
  private pathSolver?: FindClearancePathSolver
  private prepareRoute!: (routeIndex: number) => void
  private finishSetup!: () => void
  private selectSpan!: () => void
  private prepareCopper!: (spanIndex: number) => void
  private startPath!: () => void
  private applyPath?: (path: RepairRoutePoint[] | null) => void
  private updateWorkStats!: () => void

  constructor(input: NegotiatedClearanceInput) {
    super()
    this.input = input
    this.stats = {
      pathSearchNodes: 0,
      pathSearchCalls: 0,
      unresolvedSpanCount: 0,
    }
    this.MAX_ITERATIONS =
      Math.ceil(input.maxPathSearchNodes / 128) +
      input.maxPathSearchCalls *
        (input.routes.reduce((count, route) => count + route.route.length, 0) +
          input.srj.obstacles.length * input.srj.layerCount +
          128) +
      input.routes.length +
      32
  }

  override _step(): void {
    if (this.phase === "initialize") {
      this.initialize()
      return
    }
    if (this.phase === "spans") {
      const stopAt = Math.min(this.routeCursor + 32, this.input.routes.length)
      for (; this.routeCursor < stopAt; this.routeCursor++)
        this.prepareRoute(this.routeCursor)
      if (this.routeCursor === this.input.routes.length) this.phase = "setup"
      return
    }
    if (this.phase === "setup") {
      this.finishSetup()
      return
    }
    if (this.phase === "select") {
      this.selectSpan()
      this.updateWorkStats()
      return
    }
    if (this.phase === "coppers") {
      const stopAt = Math.min(this.copperCursor + 32, this.spanCount)
      for (; this.copperCursor < stopAt; this.copperCursor++)
        this.prepareCopper(this.copperCursor)
      if (this.copperCursor === this.spanCount) this.phase = "start-path"
      return
    }
    if (this.phase === "start-path") {
      this.startPath()
      return
    }
    if (this.phase === "path") {
      const child = this.pathSolver
      if (!child)
        throw new Error("repair04: negotiated search child is missing")
      child.step()
      this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS,
        this.iterations + child.MAX_ITERATIONS - child.iterations + 3)
      if (child.failed) {
        this.failed = true
        this.error = child.error
      } else if (child.solved) {
        this.activeSubSolver = null
        this.phase = "apply-path"
      }
      this.updateWorkStats()
      return
    }
    if (this.phase === "apply-path") {
      const child = this.pathSolver
      if (!child)
        throw new Error(
          "repair04: completed negotiated search child is missing",
        )
      this.applyPath!(child.getOutput())
      this.applyPath = undefined
      this.updateWorkStats()
      return
    }
    throw new Error("repair04: negotiated clearance stepped after completion")
  }

  private initialize(): void {
    const input = this.input
    for (const value of [input.maxPathSearchNodes, input.maxPathSearchCalls]) {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(
          "repair04: negotiated work budgets must be nonnegative integers",
        )
    }
    if (
      input.maxPathSearchNodesPerCall !== undefined &&
      (!Number.isSafeInteger(input.maxPathSearchNodesPerCall) ||
        input.maxPathSearchNodesPerCall < 1)
    )
      throw new Error(
        "repair04: per-path work budget must be a positive integer",
      )
    if (
      input.pathHeuristicWeight !== undefined &&
      (!Number.isFinite(input.pathHeuristicWeight) ||
        input.pathHeuristicWeight < 1)
    )
      throw new Error(
        "repair04: heuristic weight must be finite and at least one",
      )
    if (
      input.pathGridSizeScale !== undefined &&
      (!Number.isFinite(input.pathGridSizeScale) ||
        input.pathGridSizeScale <= 0)
    )
      throw new Error("repair04: path grid scale must be positive and finite")
    if (
      input.viaHoleDiameter !== undefined &&
      (!Number.isFinite(input.viaHoleDiameter) ||
        input.viaHoleDiameter <= 0 ||
        input.routes.some(
          (route): boolean => input.viaHoleDiameter! > route.viaDiameter,
        ))
    )
      throw new Error(
        "repair04: via hole diameter must be positive and fit the copper",
      )
    const inside = (point: RepairRoutePoint): boolean =>
      point.x >= input.bounds.minX - REGION_EPSILON &&
      point.x <= input.bounds.maxX + REGION_EPSILON &&
      point.y >= input.bounds.minY - REGION_EPSILON &&
      point.y <= input.bounds.maxY + REGION_EPSILON
    const spans: Span[] = []
    const byRoute: number[][] = input.routes.map((): number[] => [])

    this.prepareRoute = (ri): void => {
      const route = input.routes[ri]!
      const points: RepairRoutePoint[] = route.route
      const anchors = points.flatMap((point, pi): number[] => {
        const previous = points[pi - 1],
          next = points[pi + 1]
        const width = point.traceThickness ?? route.traceThickness
        const widthChanges =
          (previous &&
            (previous.traceThickness ?? route.traceThickness) !== width) ||
          (next && (next.traceThickness ?? route.traceThickness) !== width)
        const fixedVia =
          (previous &&
            previous.z !== point.z &&
            (!input.allowLayerChanges ||
              input.isLocked(ri, pi) ||
              input.isLocked(ri, pi - 1))) ||
          (next &&
            next.z !== point.z &&
            (!input.allowLayerChanges ||
              input.isLocked(ri, pi) ||
              input.isLocked(ri, pi + 1)))
        return pi === 0 ||
          pi === points.length - 1 ||
          input.isLocked(ri, pi) ||
          point.pcb_port_id ||
          point.toNextSegmentType ||
          point.insideJumperPad ||
          widthChanges ||
          fixedVia
          ? [pi]
          : []
      })
      for (let ai = 1; ai < anchors.length; ai++) {
        const fragment = points.slice(anchors[ai - 1], anchors[ai]! + 1)
        const width = fragment[0]!.traceThickness ?? route.traceThickness
        const hasMutableInterior = fragment
          .slice(1)
          .every((point, pi): boolean => {
            const previous = fragment[pi]!
            const x = (previous.x + point.x) / 2
            const y = (previous.y + point.y) / 2
            return (
              x > input.bounds.minX + REGION_EPSILON * 4 &&
              x < input.bounds.maxX - REGION_EPSILON * 4 &&
              y > input.bounds.minY + REGION_EPSILON * 4 &&
              y < input.bounds.maxY - REGION_EPSILON * 4
            )
          })
        const preservesLockedVias = fragment
          .slice(1)
          .every((point, pi): boolean => {
            const previous = fragment[pi]!
            const sourceIndex = anchors[ai - 1]! + pi
            return (
              previous.z === point.z ||
              (!input.isLocked(ri, sourceIndex) &&
                !input.isLocked(ri, sourceIndex + 1))
            )
          })
        const mutable =
          fragment.every(inside) &&
          hasMutableInterior &&
          preservesLockedVias &&
          !route.jumpers?.length &&
          fragment.every(
            (point): boolean =>
              !point.toNextSegmentType &&
              !point.insideJumperPad &&
              (point.traceThickness ?? route.traceThickness) === width,
          ) &&
          (input.allowLayerChanges ||
            fragment.every((point): boolean => point.z === fragment[0]!.z))
        byRoute[ri]!.push(spans.length)
        spans.push({
          routeIndex: ri,
          mutable: Boolean(mutable),
          route: withPoints({
            route: { ...route, traceThickness: width },
            points: fragment,
            mutableBounds: input.bounds,
          }),
        })
      }
    }
    this.finishSetup = (): void => {
      const current = spans.map((span): HighDensityRoute => span.route)
      const fixed = spans
        .filter((span): boolean => !span.mutable)
        .map((span): HighDensityRoute => span.route)
      const nets = getNetRepresentatives(input.srj, input.routes)
      const owner = (route: HighDensityRoute): string =>
        nets.get(route.connectionName) ?? route.connectionName
      // Span interiors can be displaced, but their fixed anchor sites cannot.
      // Reserve each physical site once even when several same-net branches meet.
      const fixedSites = new Set<string>()
      for (const span of spans) {
        for (const point of [
          span.route.route[0]!,
          span.route.route.at(-1)!,
        ] as RepairRoutePoint[]) {
          const width = point.traceThickness ?? span.route.traceThickness
          const key = `${owner(span.route)}|${point.x}|${point.y}|${point.z}|${width}`
          if (fixedSites.has(key)) continue
          fixedSites.add(key)
          const site = { x: point.x, y: point.y, z: point.z }
          fixed.push({
            ...span.route,
            traceThickness: width,
            route: [site, site],
            vias: [],
          })
        }
      }
      // The normalized penetration kernel integrates to one across a
      // perpendicular crossing. Weight it by the displaced span's routing cost,
      // so crossing a long track does not appear cheaper merely because it is thin.
      const weights = spans.map(({ route }): number => {
        let length = 0
        for (let index = 1; index < route.route.length; index++) {
          const a = route.route[index - 1]!,
            b = route.route[index]!
          length += a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1
        }
        return length
      })
      const frozen = new Set<number>()
      const dirty = new Set(input.dirtyRouteIndices)
      const queue: number[] = []
      const queued = new Set<number>()
      const enqueue = (index: number): void => {
        if (queued.has(index) || frozen.has(index) || !spans[index]!.mutable)
          return
        queued.add(index)
        queue.push(index)
      }
      spans.forEach((span, index): void => {
        if (dirty.has(span.routeIndex)) enqueue(index)
      })
      let corridorSearchCalls = 0, gridSearchCalls = 0, corridorEdgeChecks = 0
      const corridorTotals: Record<string, number> = {}
      let setupCopperEntries = 0, setupIndexEntries = 0, setupLayerTests = 0, setupSupportTests = 0
      let pathSearchNodes = 0,
        pathSearchCalls = 0,
        cursor = 0

      this.spanCount = spans.length
      this.updateWorkStats = (): void => {
        const liveCorridorStats: Record<string, unknown> = { ...corridorTotals }
        if (this.pathSolver) mergeClearanceCorridorStats(liveCorridorStats, this.pathSolver.stats)
        this.stats = {
          pathSearchNodes:
            pathSearchNodes + (this.pathSolver?.stats.nodesPopped ?? 0),
          pathSearchCalls,
          corridorSearchCalls, gridSearchCalls, corridorEdgeChecks,
          ...liveCorridorStats,
          corridorSetupCopperEntries: setupCopperEntries,
          corridorSetupCopperIndexEntries: setupIndexEntries,
          corridorSetupLayerTests: setupLayerTests,
          corridorSetupSupportTests: setupSupportTests,
          corridorNegotiationSetupWorkUnits: setupCopperEntries + setupIndexEntries + setupLayerTests + setupSupportTests,
          unresolvedSpanCount: queued.size + frozen.size,
        }
        this.progress = this.solved
          ? 1
          : Math.min(
              0.99,
              Math.max(
                this.stats.pathSearchNodes /
                  Math.max(1, input.maxPathSearchNodes),
                pathSearchCalls / Math.max(1, input.maxPathSearchCalls),
              ),
            )
      }
      this.selectSpan = (): void => {
        if (
          !(
            cursor < queue.length &&
            pathSearchNodes < input.maxPathSearchNodes &&
            pathSearchCalls < input.maxPathSearchCalls
          )
        ) {
          this.output = {
            routes: input.routes.map((route, ri): HighDensityRoute => {
              if (!byRoute[ri]!.length) return route
              const points = byRoute[ri]!.flatMap(
                (si, index): RepairRoutePoint[] =>
                  index === 0
                    ? current[si]!.route
                    : current[si]!.route.slice(1),
              )
              return withPoints({ route, points, mutableBounds: input.bounds })
            }),
            pathSearchNodes,
            pathSearchCalls,
            unresolvedSpanCount: queued.size + frozen.size,
          }

          this.solved = true
          this.phase = "finished"
          return
        }
        const index = queue[cursor++]!
        queued.delete(index)
        const route = current[index]!
        const selectedOwner = owner(route)
        const coppers: Copper[] = []

        this.copperCursor = 0
        this.prepareCopper = (si): void => {
          if (si === index) return
          const other = current[si]!,
            otherOwner = owner(other)
          for (let pi = 1; pi < other.route.length; pi++) {
            const a = other.route[pi - 1]! as RepairRoutePoint,
              b = other.route[pi]! as RepairRoutePoint
            if (a.toNextSegmentType === "through_obstacle") continue
            // Same-net wires can share copper. Distinct drill holes still require
            // clearance, including holes in otherwise immutable spans.
            const immutable = !spans[si]!.mutable || frozen.has(si)
            if (a.z === b.z && (otherOwner === selectedOwner || immutable))
              continue
            const radius =
              (a.z !== b.z
                ? other.viaDiameter
                : Math.max(
                    a.traceThickness ?? other.traceThickness,
                    b.traceThickness ?? other.traceThickness,
                  )) / 2
            const copper: Copper = {
              a,
              b,
              radius,
              minX: Math.min(a.x, b.x),
              maxX: Math.max(a.x, b.x),
              minY: Math.min(a.y, b.y),
              maxY: Math.max(a.y, b.y),
              ...getRepairCopperLayerSpan(input.srj, a, b),
              spanIndex: si,
              owner: otherOwner,
              index: coppers.length,
              cellX: Math.floor(Math.min(a.x, b.x) - radius),
              cellY: Math.floor(Math.min(a.y, b.y) - radius),
              immutable,
            }
            coppers.push(copper)
            setupCopperEntries++
          }
        }
        this.startPath = (): void => {
          const createCopperIndex = (
            indexedCopper: Copper[],
          ): { index: Flatbush; copper: Copper[] } | undefined => {
            if (!indexedCopper.length) return undefined
            const index = new Flatbush(indexedCopper.length)
            for (const copper of indexedCopper) {
              index.add(
                copper.minX - copper.radius - REGION_EPSILON,
                copper.minY - copper.radius - REGION_EPSILON,
                copper.maxX + copper.radius + REGION_EPSILON,
                copper.maxY + copper.radius + REGION_EPSILON,
              )
              setupIndexEntries++
            }
            index.finish()
            return { index, copper: indexedCopper }
          }
          const copperIndex = createCopperIndex(coppers)
          const copperByLayer = new Map<
            number,
            { index: Flatbush; copper: Copper[] } | undefined
          >()
          for (let z = 0; z < input.srj.layerCount; z++) {
            copperByLayer.set(
              z,
              createCopperIndex(
                coppers.filter(
                  (copper): boolean => {
                    setupLayerTests++
                    return copper.minZ <= z && copper.maxZ >= z
                  },
                ),
              ),
            )
          }
          const query = (
            a: RepairRoutePoint,
            b: RepairRoutePoint,
          ): Array<{ copper: Copper; ratio: number }> => {
            const via = a.z !== b.z
            const minX = Math.min(a.x, b.x),
              maxX = Math.max(a.x, b.x),
              minY = Math.min(a.y, b.y),
              maxY = Math.max(a.y, b.y)
            const reach =
              (via ? route.viaDiameter : route.traceThickness) / 2 +
              Math.max(input.traceClearance, input.viaClearance)
            const hits: Array<{ copper: Copper; ratio: number }> = []
            const span = getRepairCopperLayerSpan(input.srj, a, b)
            const activeIndex = via ? copperIndex : copperByLayer.get(a.z)
            const candidates =
              activeIndex?.index.search(
                minX - reach - REGION_EPSILON,
                minY - reach - REGION_EPSILON,
                maxX + reach + REGION_EPSILON,
                maxY + reach + REGION_EPSILON,
              ) ?? []
            for (const candidate of candidates) {
              additionalEdgeWork++
              const copper = activeIndex!.copper[candidate]!
              const bothVias = via && copper.minZ !== copper.maxZ
              const sharedLayers =
                copper.minZ <= span.maxZ && copper.maxZ >= span.minZ
              if (!sharedLayers && !bothVias) continue
              if (copper.immutable && !bothVias) continue
              if (
                copper.owner === selectedOwner &&
                (!bothVias || (a.x === copper.a.x && a.y === copper.a.y))
              )
                continue
              const copperDistance =
                (via ? route.viaDiameter : route.traceThickness) / 2 +
                (bothVias ? input.viaClearance : input.traceClearance) +
                copper.radius
              const drillDistance =
                (input.viaHoleDiameter ?? route.viaDiameter) / 2 +
                (input.viaHoleDiameter ?? copper.radius * 2) / 2 +
                input.viaClearance
              // Drill spacing applies even when the connected copper spans do
              // not share layers. Same-net copper may overlap, distinct holes may not.
              const required = bothVias
                ? sharedLayers && copper.owner !== selectedOwner
                  ? Math.max(copperDistance, drillDistance)
                  : drillDistance
                : copperDistance
              // A cell may contain many distant segments. Their axis-aligned
              // separation is a lower bound on the exact distance; preserve the
              // existing narrow-phase calculation at and near the boundary.
              if (
                minX - required - REGION_EPSILON > copper.maxX ||
                maxX + required + REGION_EPSILON < copper.minX ||
                minY - required - REGION_EPSILON > copper.maxY ||
                maxY + required + REGION_EPSILON < copper.minY
              )
                continue
              const distance = segmentToSegmentMinDistance(
                a,
                b,
                copper.a,
                copper.b,
              )
              if (distance < required - REGION_EPSILON)
                hits.push({
                  copper,
                  ratio: (required - distance) / (required * required),
                })
            }
            // Match the old integer-cell traversal order. This preserves floating
            // point accumulation and the order in which displaced spans are queued.
            const firstCellX = Math.floor(minX - reach)
            const firstCellY = Math.floor(minY - reach)
            hits.sort((left, right): number => {
              additionalEdgeWork++
              const x =
                Math.max(firstCellX, left.copper.cellX) -
                Math.max(firstCellX, right.copper.cellX)
              if (x !== 0) return x
              const y =
                Math.max(firstCellY, left.copper.cellY) -
                Math.max(firstCellY, right.copper.cellY)
              return y || left.copper.index - right.copper.index
            })
            return hits
          }
          const calculateAdditionalEdgeCost = (
            a: RepairRoutePoint,
            b: RepairRoutePoint,
          ): number => {
            const x = (a.x + b.x) / 2
            const y = (a.y + b.y) / 2
            if (
              x <= input.bounds.minX + REGION_EPSILON * 4 ||
              x >= input.bounds.maxX - REGION_EPSILON * 4 ||
              y <= input.bounds.minY + REGION_EPSILON * 4 ||
              y >= input.bounds.maxY - REGION_EPSILON * 4
            )
              return Infinity
            const costs = new Map<string, number>()
            for (const { copper, ratio } of query(a, b)) {
              if (copper.owner === selectedOwner || copper.immutable)
                return Infinity
              costs.set(
                copper.owner,
                Math.max(
                  costs.get(copper.owner) ?? 0,
                  ratio * weights[copper.spanIndex]!,
                ),
              )
            }
            let total = 0
            for (const cost of costs.values()) total += cost
            return (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) * total
          }
          // Ordinary drill sites occupy the full stack regardless of which two
          // electrical layers the search connects. Copper and weights are fixed
          // during this search, so reuse their congestion cost across transitions.
          const viaCosts = new Map<number, Map<number, number>>()
          let additionalEdgeWork = 0
          const getAdditionalEdgeCost = (
            a: RepairRoutePoint,
            b: RepairRoutePoint,
          ): number => {
            if (
              a.z === b.z ||
              input.srj.allowBlindAndBuriedVias === true ||
              a.x !== b.x ||
              a.y !== b.y
            ) {
              return calculateAdditionalEdgeCost(a, b)
            }
            let column = viaCosts.get(a.x)
            const cached = column?.get(a.y)
            if (cached !== undefined) return cached
            const cost = calculateAdditionalEdgeCost(a, b)
            if (!column) {
              column = new Map<number, number>()
              viaCosts.set(a.x, column)
            }
            column.set(a.y, cost)
            return cost
          }
          const stats: ClearancePathSearchStats = {
            nodesPopped: 0,
            completionReason: "no-path",
          }
          const additionalCostSupports: ClearanceCostSupport[] = coppers
            .filter((copper): boolean => {
              setupSupportTests++
              return !copper.immutable && copper.owner !== selectedOwner
            })
            .map((copper): ClearanceCostSupport => {
              setupSupportTests++
              const reach = route.traceThickness / 2 + input.traceClearance + copper.radius + REGION_EPSILON
              return { minX: copper.minX - reach, maxX: copper.maxX + reach,
                minY: copper.minY - reach, maxY: copper.maxY + reach,
                minZ: copper.minZ, maxZ: copper.maxZ,
                orientation: getClearanceCapsuleSupportOrientation(copper.a, copper.b, reach) }
            })
          // The midpoint boundary penalty is the only cost not owned by copper.
          const epsilon = REGION_EPSILON * 4
          additionalCostSupports.push(
            { ...input.bounds, maxX: input.bounds.minX + epsilon, minZ: 0, maxZ: input.srj.layerCount - 1 },
            { ...input.bounds, minX: input.bounds.maxX - epsilon, minZ: 0, maxZ: input.srj.layerCount - 1 },
            { ...input.bounds, maxY: input.bounds.minY + epsilon, minZ: 0, maxZ: input.srj.layerCount - 1 },
            { ...input.bounds, minY: input.bounds.maxY - epsilon, minZ: 0, maxZ: input.srj.layerCount - 1 },
          )
          const solver = new FindClearancePathSolver({
            srj: input.srj,
            routes: [...fixed, route],
            routeIndex: fixed.length,
            start: route.route[0]!,
            end: route.route.at(-1)!,
            bounds: input.bounds,
            traceThickness: route.traceThickness,
            traceClearance: input.traceClearance,
            viaClearance: input.viaClearance,
            gridSize: Math.min(
              0.1,
              (route.traceThickness * (input.pathGridSizeScale ?? 1)) / 2,
            ),
            allowLayerChanges: input.allowLayerChanges,
            maxNodes: Math.min(
              input.maxPathSearchNodesPerCall ?? input.maxPathSearchNodes,
              input.maxPathSearchNodes - pathSearchNodes,
            ),
            heuristicWeight: input.pathHeuristicWeight,
            stats,
            getAdditionalEdgeCost,
            additionalCostSupports,
            getAdditionalEdgeWork: (): number => additionalEdgeWork,
            existingPath: route.route,
            viaHoleDiameter: input.viaHoleDiameter,
          })

          this.pathSolver = solver
          this.activeSubSolver = solver
          // Fixed/preloaded geometry can make setup exceed the original estimate.
          // Reserve the actual child limit plus apply/queue completion steps.
          this.MAX_ITERATIONS = Math.max(
            this.MAX_ITERATIONS,
            this.iterations + solver.MAX_ITERATIONS + 3,
          )
          this.phase = "path"
          this.applyPath = (path): void => {
            if ((stats as ClearancePathSearchStats & { searchGraph?: string }).searchGraph === "corridors") corridorSearchCalls++
            else if ((stats as ClearancePathSearchStats & { searchGraph?: string }).searchGraph === "grid") gridSearchCalls++
            corridorEdgeChecks += (stats as ClearancePathSearchStats & { corridorEdgeChecks?: number }).corridorEdgeChecks ?? 0
            mergeClearanceCorridorStats(corridorTotals, stats)
            pathSearchCalls++
            pathSearchNodes += stats.nodesPopped
            input.onSearch?.(stats)
            if (!path) {
              frozen.add(index)
              fixed.push(route)
              this.phase = "select"
              this.pathSolver = undefined
              return
            }
            current[index] = withPoints({
              route,
              points: path,
              mutableBounds: input.bounds,
            })
            const conflicts = new Set<number>()
            for (let pi = 1; pi < path.length; pi++)
              for (const { copper } of query(path[pi - 1]!, path[pi]!))
                conflicts.add(copper.spanIndex)
            for (const other of [...conflicts].sort((a, b): number => a - b)) {
              weights[other]!++
              enqueue(other)
            }
            if (conflicts.size) {
              weights[index]!++
              enqueue(index)
            }
            this.phase = "select"
            this.pathSolver = undefined
          }
        }
        this.phase = "coppers"
      }
      this.phase = "select"
      this.updateWorkStats()
    }
    this.phase = "spans"
  }

  override getOutput(): NegotiatedClearanceResult {
    if (!this.solved || this.failed || !this.output) {
      throw new Error(
        "repair04: negotiated clearance output requested before completion",
      )
    }
    return this.output
  }

  getResult(): NegotiatedClearanceResult {
    return this.getOutput()
  }
}

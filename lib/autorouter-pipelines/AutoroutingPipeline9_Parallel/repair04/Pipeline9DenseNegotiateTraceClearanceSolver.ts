/**
 * Prototype derivative of @tscircuit/repair04 at
 * 81d4585d335ea1958a1c6569e4064c58cba44bad (MIT, see ./LICENSE).
 * Preserve the pinned solver's search order, floating point operations,
 * geometry and work accounting; only storage and repeated pure calculations
 * differ. Public helpers use the pinned dependency; private helpers are copied unchanged.
 */
import type {
  NegotiatedClearanceInput,
  NegotiatedClearanceResult,
} from "@tscircuit/repair04"
import { BaseSolver } from "@tscircuit/solver-utils"
import { Pipeline9DenseClearancePathSolver as FindClearancePathSolver } from "./Pipeline9DenseClearancePathSolver"
import { prepareSegmentDistanceGeometry, segmentToSegmentMinDistanceWithGeometry,
  updateSegmentDistanceGeometry, type SegmentDistanceGeometry } from "./segmentToSegmentMinDistanceWithGeometry"
import Flatbush from "flatbush"
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { type ClearancePathSearchStats } from "@tscircuit/repair04"
import { getNetRepresentatives } from "./repair04Helpers"
import { getRepairCopperLayerSpan } from "./repair04Helpers"
import { REGION_EPSILON } from "./repair04Helpers"
import type { Bounds, RepairRoutePoint } from "./repair04Helpers"

type Span = {
  routeIndex: number
  mutable: boolean
  route: HighDensityRoute
}
type Copper = SegmentDistanceGeometry & {
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
  sameOwner: boolean
  wireRequired: number
  viaWireRequired: number
  viaDrillRequired: number
  viaSharedRequired: number
  ownerIndex: number
  index: number
  cellX: number
  cellY: number
  immutable: boolean
}
function withPoints(
  route: HighDensityRoute,
  points: RepairRoutePoint[],
): HighDensityRoute {
  const vias: HighDensityRoute["vias"] = []
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!
    if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
    if (a.x !== b.x || a.y !== b.y)
      throw new Error("repair04: negotiated via endpoints must coincide")
    if (!vias.some((via): boolean => via.x === b.x && via.y === b.y))
      vias.push({ x: b.x, y: b.y })
  }
  return { ...route, route: points, vias }
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
export class Pipeline9DenseNegotiateTraceClearanceSolver extends BaseSolver {
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
          route: withPoints({ ...route, traceThickness: width }, fragment),
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
      let pathSearchNodes = 0,
        pathSearchCalls = 0,
        cursor = 0

      this.spanCount = spans.length
      this.updateWorkStats = (): void => {
        this.stats = {
          pathSearchNodes:
            pathSearchNodes + (this.pathSolver?.stats.nodesPopped ?? 0),
          pathSearchCalls,
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
              return withPoints(route, points)
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
        const ownerIndices = new Map<string, number>()

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
            const viaDrillRequired =
              (input.viaHoleDiameter ?? route.viaDiameter) / 2 +
              (input.viaHoleDiameter ?? radius * 2) / 2 +
              input.viaClearance
            let ownerIndex = ownerIndices.get(otherOwner)
            if (ownerIndex === undefined) {
              ownerIndex = ownerIndices.size
              ownerIndices.set(otherOwner, ownerIndex)
            }
            const copper: Copper = {
              a,
              b,
              radius,
              ...prepareSegmentDistanceGeometry(a, b),
              ...getRepairCopperLayerSpan(input.srj, a, b),
              spanIndex: si,
              sameOwner: otherOwner === selectedOwner,
              // Geometry, route dimensions and clearances are immutable for
              // this one search. Retain the original arithmetic order once.
              wireRequired: route.traceThickness / 2 + input.traceClearance + radius,
              viaWireRequired: route.viaDiameter / 2 + input.traceClearance + radius,
              viaDrillRequired,
              viaSharedRequired: Math.max(route.viaDiameter / 2 + input.viaClearance + radius, viaDrillRequired),
              ownerIndex,
              index: coppers.length,
              cellX: Math.floor(Math.min(a.x, b.x) - radius),
              cellY: Math.floor(Math.min(a.y, b.y) - radius),
              immutable,
            }
            coppers.push(copper)
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
                  (copper): boolean => copper.minZ <= z && copper.maxZ >= z,
                ),
              ),
            )
          }
          // Congestion queries are synchronous. Both callers consume all hits
          // immediately, before another query, so reuse their scratch storage
          // while retaining the same stable sort and owner accumulation order.
          const hits: Array<{ copper: Copper; ratio: number }> = []
          const hitPool: Array<{ copper: Copper; ratio: number }> = []
          const ownerCosts = new Float64Array(ownerIndices.size)
          const ownerCostQueries = new Uint32Array(ownerIndices.size)
          const ownerFirstCopperIndices = new Int32Array(ownerIndices.size)
          const touchedOwners: number[] = []
          let ownerCostQueryId = 0
          let queryBlocked = false
          const gridSize = Math.min(
            0.1,
            (route.traceThickness * (input.pathGridSizeScale ?? 1)) / 2,
          )
          const localStep = gridSize + REGION_EPSILON * 4
          const emptyCandidates: number[] = []
          const localQuery: {
            x: number
            y: number
            z: number
            minX: number
            maxX: number
            minY: number
            maxY: number
            candidates?: number[]
          } = {
            x: NaN, y: NaN, z: NaN,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
          }
          const edgeGeometry: SegmentDistanceGeometry = { aX: 0, aY: 0, bX: 0, bY: 0,
            dx: 0, dy: 0, l2: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }
          const query = (
            a: RepairRoutePoint,
            b: RepairRoutePoint,
            accumulateOwnerCosts = false,
          ): Array<{ copper: Copper; ratio: number }> => {
            const via = a.z !== b.z
            const minX = Math.min(a.x, b.x),
              maxX = Math.max(a.x, b.x),
              minY = Math.min(a.y, b.y),
              maxY = Math.max(a.y, b.y)
            const reach =
              (via ? route.viaDiameter : route.traceThickness) / 2 +
              Math.max(input.traceClearance, input.viaClearance)
            hits.length = 0
            queryBlocked = false
            const firstCellX = Math.floor(minX - reach)
            const firstCellY = Math.floor(minY - reach)
            const span = via ? getRepairCopperLayerSpan(input.srj, a, b) : undefined
            const activeIndex = via ? copperIndex : copperByLayer.get(a.z)
            let edgeGeometryPrepared = false
            let candidates: number[] | undefined
            if (!via) {
              if (
                a.x !== localQuery.x ||
                a.y !== localQuery.y ||
                a.z !== localQuery.z
              ) {
                localQuery.x = a.x
                localQuery.y = a.y
                localQuery.z = a.z
                localQuery.minX = a.x - localStep
                localQuery.maxX = a.x + localStep
                localQuery.minY = a.y - localStep
                localQuery.maxY = a.y + localStep
                localQuery.candidates = undefined
              }
              if (
                b.x >= localQuery.minX && b.x <= localQuery.maxX &&
                b.y >= localQuery.minY && b.y <= localQuery.maxY
              ) {
                // One expansion evaluates eight nearby wire edges. Their
                // endpoints lie in this explicitly checked inner rectangle,
                // so its enlarged query encloses every original edge query.
                // Keep the exact edge-specific narrow phase and hit sort.
                candidates = localQuery.candidates ??=
                  activeIndex?.index.search(
                    localQuery.minX - reach - REGION_EPSILON,
                    localQuery.minY - reach - REGION_EPSILON,
                    localQuery.maxX + reach + REGION_EPSILON,
                    localQuery.maxY + reach + REGION_EPSILON,
                  ) ?? emptyCandidates
              }
            }
            candidates ??= activeIndex?.index.search(
                minX - reach - REGION_EPSILON,
                minY - reach - REGION_EPSILON,
                maxX + reach + REGION_EPSILON,
                maxY + reach + REGION_EPSILON,
              ) ?? emptyCandidates
            for (const candidate of candidates) {
              const copper = activeIndex!.copper[candidate]!
              const bothVias = via && copper.minZ !== copper.maxZ
              const sharedLayers =
                !via || (copper.minZ <= span!.maxZ && copper.maxZ >= span!.minZ)
              if (!sharedLayers && !bothVias) continue
              if (copper.immutable && !bothVias) continue
              if (
                copper.sameOwner &&
                (!bothVias || (a.x === copper.a.x && a.y === copper.a.y))
              )
                continue
              // Drill spacing applies even when the connected copper spans do
              // not share layers. Same-net copper may overlap, distinct holes may not.
              const required = bothVias
                ? sharedLayers && !copper.sameOwner
                  ? copper.viaSharedRequired
                  : copper.viaDrillRequired
                : via ? copper.viaWireRequired : copper.wireRequired
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
              if (!edgeGeometryPrepared) {
                updateSegmentDistanceGeometry(edgeGeometry, a, b)
                edgeGeometryPrepared = true
              }
              const distance = segmentToSegmentMinDistanceWithGeometry(edgeGeometry, copper)
              if (distance < required - REGION_EPSILON) {
                const ratio = (required - distance) / (required * required)
                if (accumulateOwnerCosts) {
                  // A forbidden hit determines the complete edge cost. The
                  // remaining narrow-phase work has no state or queue effects.
                  if (copper.sameOwner || copper.immutable) {
                    queryBlocked = true
                    break
                  }
                  const ownerIndex = copper.ownerIndex
                  const seen = ownerCostQueries[ownerIndex] === ownerCostQueryId
                  ownerCosts[ownerIndex] = Math.max(
                    seen ? ownerCosts[ownerIndex]! : 0,
                    ratio * weights[copper.spanIndex]!,
                  )
                  if (!seen) {
                    ownerCostQueries[ownerIndex] = ownerCostQueryId
                    ownerFirstCopperIndices[ownerIndex] = copper.index
                    touchedOwners.push(ownerIndex)
                  } else {
                    const firstCopper = coppers[ownerFirstCopperIndices[ownerIndex]!]!
                    const x = Math.max(firstCellX, copper.cellX) - Math.max(firstCellX, firstCopper.cellX)
                    const y = Math.max(firstCellY, copper.cellY) - Math.max(firstCellY, firstCopper.cellY)
                    if (x < 0 || (x === 0 && (y < 0 || (y === 0 && copper.index < firstCopper.index))))
                      ownerFirstCopperIndices[ownerIndex] = copper.index
                  }
                  continue
                }
                let hit = hitPool[hits.length]
                if (!hit) {
                  hit = { copper, ratio }
                  hitPool.push(hit)
                } else {
                  hit.copper = copper
                  hit.ratio = ratio
                }
                hits.push(hit)
              }
            }
            // Match the old integer-cell traversal order. This preserves floating
            // point accumulation and the order in which displaced spans are queued.
            if (!accumulateOwnerCosts) hits.sort((left, right): number => {
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
            // Integer owner identities are stable during this one search. A
            // visit stamp avoids per-edge Map entries; first-touch ordering
            // retains the exact previous Map.values() summation order.
            if (++ownerCostQueryId > 0xffff_ffff) {
              ownerCostQueries.fill(0)
              ownerCostQueryId = 1
            }
            touchedOwners.length = 0
            query(a, b, true)
            if (queryBlocked) return Infinity
            // Per-owner maxima are independent of hit order. Sum owners in the
            // original first-hit order by sorting each owner's minimum copper
            // key, rather than sorting every individual colliding segment.
            const reach = (a.z !== b.z ? route.viaDiameter : route.traceThickness) / 2 +
              Math.max(input.traceClearance, input.viaClearance)
            const firstCellX = Math.floor(Math.min(a.x, b.x) - reach)
            const firstCellY = Math.floor(Math.min(a.y, b.y) - reach)
            touchedOwners.sort((leftOwner, rightOwner): number => {
              const left = coppers[ownerFirstCopperIndices[leftOwner]!]!
              const right = coppers[ownerFirstCopperIndices[rightOwner]!]!
              const x = Math.max(firstCellX, left.cellX) - Math.max(firstCellX, right.cellX)
              if (x !== 0) return x
              const y = Math.max(firstCellY, left.cellY) - Math.max(firstCellY, right.cellY)
              return y || left.index - right.index
            })
            let total = 0
            for (const ownerIndex of touchedOwners)
              total += ownerCosts[ownerIndex]!
            return (a.z === b.z ? Math.hypot(a.x - b.x, a.y - b.y) : 1) * total
          }
          // Ordinary drill sites occupy the full stack regardless of which two
          // electrical layers the search connects. Copper and weights are fixed
          // during this search, so reuse their congestion cost across transitions.
          const viaCosts = new Map<number, Map<number, number>>()
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
            gridSize,
            allowLayerChanges: input.allowLayerChanges,
            maxNodes: Math.min(
              input.maxPathSearchNodesPerCall ?? input.maxPathSearchNodes,
              input.maxPathSearchNodes - pathSearchNodes,
            ),
            heuristicWeight: input.pathHeuristicWeight,
            stats,
            getAdditionalEdgeCost,
            synchronousEdgeCosts: true,
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
            current[index] = withPoints(route, path)
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

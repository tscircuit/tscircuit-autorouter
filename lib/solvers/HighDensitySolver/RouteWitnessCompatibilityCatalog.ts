import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { PriorityTask } from "./decomposePriorityTasks"

type Charge = (name: string, count?: number) => void
type Params = {
  tasks: readonly PriorityTask[]
  owners: readonly string[]
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  clearance: number
  viaHoleDiameter: number
  minimumHoleGap: number
  traceWidth: number
  viaDiameter: number
  regionId: string
  diagnostics?: Record<string, number>
  maxWitnessesPerTask?: number
  maxSelectionVisits?: number
}

export type RouteCompatibilityWitness = {
  readonly id: number
  readonly task: number
  readonly route: HighDensityIntraNodeRoute
  readonly signature: string
  readonly contextId: number
}

export type RouteWitnessCompatibilitySession = {
  // Owned by ONE portfolio and ONE immutable physical node/obstacle/outline
  // scene. Do not reuse this session across caller edits, nodes or growth
  // attempts: final-check no-goods depend on that scene, not just contextKey.
  catalog?: RouteWitnessCompatibilityCatalog
}

/**
 * A bounded route-choice CSP, rather than another priority ordering search.
 * Concrete paths can be combined across native search contexts: their costs
 * need not match, but their exact final copper and drills must be compatible.
 * Exhausting this catalog says nothing about paths not in the catalog.
 * Inputs are the native Single solver's ordinary wire/via paths. Jumper routes
 * and nested through-obstacle metadata are outside this catalog's input slice.
 * contextKey checks task/owner/pair rules; it is NOT a whole-scene cache key.
 */
export class RouteWitnessCompatibilityCatalog {
  readonly stats: Record<string, number>
  readonly contextKey: string
  private readonly params: Params
  private readonly catalogs: RouteCompatibilityWitness[][]
  private readonly byRoute = new WeakMap<HighDensityIntraNodeRoute, RouteCompatibilityWitness>()
  private readonly pairCache = new WeakMap<RouteCompatibilityWitness, WeakMap<RouteCompatibilityWitness, boolean>>()
  private readonly rejectedSelections = new Set<string>()
  private readonly contextIds = new WeakMap<object, number>()
  private nextContextId = 0
  private nextId = 0
  private revision = 0
  private searchedRevision = -1
  private cachedSelection: RouteCompatibilityWitness[] | null = null

  constructor(params: Params) {
    if (
      params.tasks.length < 2 || params.tasks.length !== params.owners.length ||
      !Number.isSafeInteger(params.layerCount) || params.layerCount < 1 ||
      !Number.isFinite(params.clearance) || params.clearance < 0 ||
      !Number.isFinite(params.viaHoleDiameter) || params.viaHoleDiameter <= 0 ||
      !Number.isFinite(params.minimumHoleGap) || params.minimumHoleGap < 0 ||
      !Number.isFinite(params.traceWidth) || params.traceWidth <= 0 ||
      !Number.isFinite(params.viaDiameter) || params.viaDiameter <= 0
    ) throw new Error("Invalid route compatibility catalog context")
    const capacity = params.maxWitnessesPerTask ?? 6
    const visits = params.maxSelectionVisits ?? Math.min(20_000, Math.max(512, params.tasks.length ** 2 * 16))
    if (!Number.isSafeInteger(capacity) || capacity < 2 || !Number.isSafeInteger(visits) || visits < 1)
      throw new Error("Invalid route compatibility search allowance")
    this.params = {
      ...params,
      tasks: params.tasks.map((task) => ({ ...task, points: task.points.map((p) => ({ ...p })) })),
      owners: [...params.owners],
      maxWitnessesPerTask: capacity,
      maxSelectionVisits: visits,
    }
    this.contextKey = RouteWitnessCompatibilityCatalog.getContextKey(params)
    this.catalogs = params.tasks.map(() => [])
    this.stats = params.diagnostics ?? {}
    this.record("witnessCatalogInstances")
  }

  static getContextKey(params: Params): string {
    return JSON.stringify([
      params.tasks, params.owners, params.layerCount,
      params.allowBlindAndBuriedVias === true, params.clearance,
      params.viaHoleDiameter, params.minimumHoleGap, params.traceWidth,
      params.viaDiameter, params.regionId,
    ])
  }

  private record(name: string, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid route compatibility counter")
    this.stats[name] = (this.stats[name] ?? 0) + count
  }

  add(task: number, route: HighDensityIntraNodeRoute, charge: Charge, context?: object): RouteCompatibilityWitness {
    const expected = this.params.tasks[task]
    if (!expected) throw new Error("Unknown route compatibility task")
    const a = route.route[0], b = route.route.at(-1)
    const [start, end] = expected.points
    if (
      !a || !b || route.connectionName !== expected.connectionName ||
      route.rootConnectionName !== expected.rootConnectionName ||
      route.traceThickness !== this.params.traceWidth || route.viaDiameter !== this.params.viaDiameter ||
      route.regionId !== this.params.regionId ||
      a.x !== start.x || a.y !== start.y || a.z !== start.z ||
      b.x !== end.x || b.y !== end.y || b.z !== end.z
    ) throw new Error("Mismatched route compatibility witness identity")
    for (const point of route.route) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isSafeInteger(point.z) || point.z < 0 || point.z >= this.params.layerCount)
        throw new Error("Invalid route compatibility witness point")
    }
    for (const via of route.vias) {
      if (!Number.isFinite(via.x) || !Number.isFinite(via.y))
        throw new Error("Invalid route compatibility witness via")
    }
    charge("witnessCatalogSignatureVertices", route.route.length + route.vias.length + 1)
    // No coordinate rounding: a conflict clause names these exact geometries.
    const signature = JSON.stringify([route.route, route.vias, route.traceThickness, route.viaDiameter])
    const catalog = this.catalogs[task]
    const duplicate = catalog.find((w) => w.signature === signature)
    if (duplicate) {
      this.byRoute.set(route, duplicate)
      this.record("witnessCatalogDuplicatePaths")
      return duplicate
    }
    const copy: HighDensityIntraNodeRoute = {
      ...route,
      route: route.route.map((p) => Object.freeze({ ...p })),
      vias: route.vias.map((v) => Object.freeze({ ...v })),
    }
    Object.freeze(copy.route)
    Object.freeze(copy.vias)
    Object.freeze(copy)
    let contextId = -1
    if (context) {
      const existing = this.contextIds.get(context)
      contextId = existing === undefined ? this.nextContextId++ : existing
      this.contextIds.set(context, contextId)
    }
    const witness: RouteCompatibilityWitness = Object.freeze({ id: this.nextId++, task, route: copy, signature, contextId })
    // Retain the original independent path and recent alternatives. Old pair
    // entries are weak, so eviction does not retain an unbounded search history.
    if (catalog.length === this.params.maxWitnessesPerTask) {
      catalog.splice(1, 1)
      this.record("witnessCatalogEvictions")
    }
    catalog.push(witness)
    this.byRoute.set(route, witness)
    this.byRoute.set(copy, witness)
    this.revision++
    this.cachedSelection = null
    this.record("witnessCatalogPaths")
    this.record("witnessCatalogStoredVertices", copy.route.length + copy.vias.length)
    return witness
  }

  conflict(left: RouteCompatibilityWitness, right: RouteCompatibilityWitness, charge: Charge): boolean {
    if (left.task === right.task) throw new Error("Compared alternatives for the same route task")
    const a = left.id < right.id ? left : right
    const b = left.id < right.id ? right : left
    charge("witnessCompatibilityPairQueryWork")
    this.record("witnessCompatibilityPairQueries")
    const cached = this.pairCache.get(a)?.get(b)
    if (cached !== undefined) {
      this.record("witnessCompatibilityPairCacheHits")
      return cached
    }
    const sameOwner = this.params.owners[a.task] === this.params.owners[b.task]
    let collision = false
    for (const va of a.route.vias) {
      for (const vb of b.route.vias) {
        charge("witnessCompatibilityDrillPairs")
        const distance = Math.hypot(va.x - vb.x, va.y - vb.y)
        if (distance === 0 && sameOwner) continue
        if (distance < this.params.viaHoleDiameter + this.params.minimumHoleGap) {
          collision = true
          break
        }
      }
      if (collision) break
    }
    if (!collision && !sameOwner) {
      charge("witnessCompatibilityGeometryPrimitives", a.route.route.length + a.route.vias.length + b.route.route.length + b.route.vias.length)
      const x = getPipeline9RouteCopperGeometry(a.route, this.params)
      const y = getPipeline9RouteCopperGeometry(b.route, this.params)
      charge("witnessCompatibilityPrimitivePairs", (x.wireSegments.length + x.viaSpans.length) * (y.wireSegments.length + y.viaSpans.length))
      collision = doPipeline9RoutesHaveCopperConflict({
        left: a.route, right: b.route, clearance: this.params.clearance,
        layerCount: this.params.layerCount,
        allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      })
    }
    const entries = this.pairCache.get(a) ?? new WeakMap<RouteCompatibilityWitness, boolean>()
    entries.set(b, collision)
    this.pairCache.set(a, entries)
    this.record("witnessCompatibilityPairEvaluations")
    if (collision) this.record("witnessCompatibilityLearnedPairExclusions")
    return collision
  }

  conflictRoutes(leftTask: number, left: HighDensityIntraNodeRoute, rightTask: number, right: HighDensityIntraNodeRoute, charge: Charge): boolean {
    const a = this.byRoute.get(left)
    const b = this.byRoute.get(right)
    if (!a || !b || a.task !== leftTask || b.task !== rightTask)
      throw new Error("Missing immutable route compatibility witness")
    return this.conflict(a, b, charge)
  }

  select(charge: Charge): RouteCompatibilityWitness[] | null {
    if (this.searchedRevision === this.revision) return this.cachedSelection
    if (this.catalogs.some((catalog) => catalog.length === 0)) {
      this.searchedRevision = this.revision
      return null
    }
    // A single complete context is already available to the existing DAG.
    // Rechecking it with a CSP and board DRC cannot save any route generation.
    // Singleton catalogs from DIFFERENT contexts can still be a useful join.
    if (this.catalogs.every((catalog) => catalog.length === 1) &&
      new Set(this.catalogs.map((catalog) => catalog[0].contextId)).size === 1) {
      this.searchedRevision = this.revision
      return null
    }
    this.searchedRevision = this.revision
    this.record("witnessCompatibilitySelections")
    const started = performance.now()
    let visits = 0
    let capped = false
    const selected: Array<RouteCompatibilityWitness | undefined> = this.catalogs.map(() => undefined)
    const search = (remaining: number): boolean => {
      if (remaining === 0) {
        const key = selected.map((w) => w!.id).join(",")
        return !this.rejectedSelections.has(key)
      }
      let bestTask = -1
      let bestOptions: RouteCompatibilityWitness[] | null = null
      for (let task = 0; task < this.catalogs.length; task++) {
        if (selected[task]) continue
        const options: RouteCompatibilityWitness[] = []
        // Recent alternatives first; original independent geometry remains in
        // the bounded catalog and can be combined with any later witness.
        for (let i = this.catalogs[task].length - 1; i >= 0; i--) {
          if (++visits > this.params.maxSelectionVisits!) {
            capped = true
            return false
          }
          charge("witnessCompatibilitySelectionVisitWork")
          const witness = this.catalogs[task][i]
          let valid = true
          for (const other of selected) {
            if (other && this.conflict(witness, other, charge)) {
              valid = false
              break
            }
          }
          if (valid) options.push(witness)
        }
        if (options.length === 0) return false
        if (bestOptions === null || options.length < bestOptions.length) {
          bestTask = task
          bestOptions = options
        }
      }
      if (bestTask === -1 || bestOptions === null)
        throw new Error("Missing compatibility search domain")
      for (const witness of bestOptions) {
        selected[bestTask] = witness
        if (search(remaining - 1)) return true
        selected[bestTask] = undefined
        if (capped) return false
      }
      return false
    }
    const found = search(this.catalogs.length)
    this.record("witnessCompatibilitySelectionMicroseconds", Math.round((performance.now() - started) * 1000))
    this.record("witnessCompatibilitySelectionVisits", visits)
    if (!found) {
      this.record(capped ? "witnessCompatibilitySelectionCaps" : "witnessCompatibilityPoolExhaustions")
      // UNKNOWN about the physical routing problem. Native conflict-driven
      // search continues to generate new witnesses under its existing budget.
      return null
    }
    this.cachedSelection = selected.map((w) => {
      if (!w) throw new Error("Incomplete compatibility assignment")
      return w
    })
    this.record("witnessCompatibilityAssignments")
    return this.cachedSelection
  }

  rejectSelection(selection: readonly RouteCompatibilityWitness[]): void {
    if (selection.length !== this.catalogs.length || selection.some((w, task) => w.task !== task))
      throw new Error("Invalid rejected compatibility assignment")
    // Bound final-check no-goods too. Clearing only loses pruning; it cannot
    // turn a physically invalid assignment into a successful route.
    if (this.rejectedSelections.size >= 64) this.rejectedSelections.clear()
    this.rejectedSelections.add(selection.map((w) => w.id).join(","))
    this.cachedSelection = null
    // At most one final-check proposal per new path. Rejected assignments must
    // not starve the native generator by repeatedly solving a fixed catalog.
    this.searchedRevision = this.revision
    this.record("witnessCompatibilityRejectedAssignments")
  }
}

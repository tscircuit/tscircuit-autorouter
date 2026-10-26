import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { IntraNodeRouteSolver } from "./IntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { extendPriorityDag, type PriorityDagState } from "./priorityDagState"

import {
  decomposePriorityTasks,
  type PriorityTask as Task,
} from "./decomposePriorityTasks"

type Witness = {
  route: HighDensityIntraNodeRoute
  ancestors: Array<[number, Witness]>
}
type State = PriorityDagState<Witness>
type Params = ConstructorParameters<typeof IntraNodeRouteSolver>[0] & {
  priorityFamilySize: number
  priorityDiagnostics?: Record<string, number>
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  allowBlindAndBuriedVias?: boolean
}
class PriorityWorkLimitReached extends Error {}

/**
 * Conflict-driven static priorities, with native Single routing below them.
 * Unlike a native complete ordering, unrelated tasks are NOT earlier copper.
 * Futures are canonical nonancestors. This is an explicit routing policy change,
 * not an exact cache for native shuffles, a complete solver, or an UNSAT proof.
 */
export class PriorityDagIntraNodeSolver extends IntraNodeRouteSolver {
  static detailedWorkDiagnostics = false
  readonly detailedWorkDiagnosticsEnabled =
    PriorityDagIntraNodeSolver.detailedWorkDiagnostics
  readonly priorityDiagnostics: Record<string, number> = {}
  readonly familySize: number
  readonly coordinateScale: number
  private terminalRecorded = false
  private readonly aggregate?: Record<string, number>
  private readonly tasks: Task[] = []
  private readonly owner: string[] = []
  private readonly board: {
    layerCount: number
    allowBlindAndBuriedVias?: boolean
  } = { layerCount: 2 }
  private readonly stack: State[] = []
  private readonly visited = new Set<string>()
  private current?: State
  private currentTask = -1
  private nativeTaskOptions?: ConstructorParameters<typeof Native>[0]
  private todo: number[] = []
  private pairLeft = 0
  private pairRight = 1
  private finalTask = 0
  private readyToValidate = false
  private readonly expectedNativeCandidateAllowance: number
  readonly nativeCandidateIterationLimit: number
  private readonly viaHoleDiameter: number
  private readonly minimumHoleGap: number
  private readonly nativeBounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  private readonly allowedLayers: number[] = []
  private readonly regionId: string = ""

  constructor(params: Params) {
    super(params)
    this.aggregate = params.priorityDiagnostics
    this.coordinateScale = params.priorityCoordinateScale ?? 1
    if (!Number.isFinite(this.coordinateScale) || this.coordinateScale <= 0)
      throw new Error("Invalid priority coordinate scale")
    this.familySize = params.priorityFamilySize
    if (!Number.isSafeInteger(this.familySize) || this.familySize < 1)
      throw new Error("Invalid priority family allocation")
    this.nativeCandidateIterationLimit = this.MAX_ITERATIONS
    this.expectedNativeCandidateAllowance = Math.floor(this.MAX_ITERATIONS) + 1
    const allocation = this.familySize * this.expectedNativeCandidateAllowance
    if (!Number.isSafeInteger(allocation))
      throw new Error("Unsafe priority family work allocation")
    // Reserve one observation slot below the removed native family's summed
    // floor(MAX)+1 allowances. New setup is charged BEFORE supervisor selection.
    this.MAX_ITERATIONS = allocation - 1
    this.viaHoleDiameter = params.viaHoleDiameter ?? this.viaDiameter
    this.minimumHoleGap = params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1
    if (
      !Number.isFinite(this.viaHoleDiameter) ||
      this.viaHoleDiameter <= 0 ||
      !Number.isFinite(this.minimumHoleGap) ||
      this.minimumHoleGap < 0
    )
      throw new Error("Invalid priority drill geometry")
    for (const [key, value] of Object.entries({
      priorityInstances: 1,
      priorityRemovedNativeCandidates: this.familySize,
      priorityAllocatedWorkUnits: this.MAX_ITERATIONS,
      priorityDetailedInstances: Number(this.detailedWorkDiagnosticsEnabled),
      priorityCoordinateScaleSum: this.coordinateScale,
      priorityScaledInstances: Number(this.coordinateScale !== 1),
    })) {
      this.priorityDiagnostics[key] = value
      if (this.aggregate)
        this.aggregate[key] = (this.aggregate[key] ?? 0) + value
    }
    try {
      this.charge(
        "priorityOwnedContextSnapshots",
        3 + Object.keys(this.hyperParameters).length,
      )
      this.nativeBounds = {
        ...getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints),
      }
      this.regionId = this.nodeWithPortPoints.capacityMeshNodeId
      this.hyperParameters = Object.freeze({ ...this.hyperParameters })
      if (this.nodeWithPortPoints.availableZ?.length) {
        this.charge(
          "priorityAllowedLayerCopies",
          this.nodeWithPortPoints.availableZ.length,
        )
        this.allowedLayers = [...this.nodeWithPortPoints.availableZ]
      } else {
        const layers = new Set<number>()
        for (const point of this.nodeWithPortPoints.portPoints) {
          this.charge("priorityAllowedLayerVisits")
          layers.add(point.z ?? 0)
        }
        this.allowedLayers = [...layers].sort((a, b) => {
          this.charge("priorityAllowedLayerComparisons")
          return a - b
        })
      }
      // This upper bound also pays the portfolio's domain eligibility pass.
      // Every family pays it, so no eligible preflight work is hidden for free.
      this.charge(
        "priorityEligibilityUpperBound",
        this.unsolvedConnections.reduce(
          (sum, t) => sum + 2 + t.points.length * 3,
          0,
        ),
      )
      const tasks = decomposePriorityTasks(
        this.unsolvedConnections,
        this.charge,
      )
      if (!tasks)
        throw new Error("Priority DAG requires nondegenerate native star tasks")
      this.tasks = tasks
      this.charge("priorityLayerExtentUpperBound", this.tasks.length * 2)
      this.board = {
        layerCount:
          params.layerCount ??
          Math.max(
            2,
            ...this.tasks.flatMap((t) => t.points.map((p) => p.z + 1)),
          ),
        allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      }
      this.owner = this.tasks.map((task) => {
        this.charge("priorityOwnerLookups")
        const net = this.connMap?.getNetConnectedToId(task.connectionName)
        if (net === undefined)
          return JSON.stringify(["literal", task.connectionName])
        const members = this.connMap!.netMap[net]
        if (!Array.isArray(members))
          throw new Error("Missing indexed priority owner members")
        let found = false
        for (const id of members) {
          this.charge("priorityOwnerMemberVisits")
          if (id === task.connectionName) {
            found = true
            break
          }
        }
        if (!found)
          throw new Error(
            `Stale indexed priority owner for ${task.connectionName}`,
          )
        // Follow the native idToNetMap authority exactly once. Never resolve
        // the returned net key again; literal and registered namespaces differ.
        return JSON.stringify(["registered", net])
      })
      this.charge("priorityInitialStateSlots", this.tasks.length * 3 + 1)
      this.stack.push({
        ancestors: this.tasks.map(() => new Set()),
        witnesses: this.tasks.map(() => undefined),
      })
    } catch (error) {
      if (!(error instanceof PriorityWorkLimitReached)) throw error
      this.unknown("owned setup exhausted aggregate family work allowance")
    }
  }

  private record(name: string, count = 1): void {
    if (!this.detailedWorkDiagnosticsEnabled) return
    this.priorityDiagnostics[name] =
      (this.priorityDiagnostics[name] ?? 0) + count
    if (this.aggregate) {
      this.aggregate[name] = (this.aggregate[name] ?? 0) + count
    }
  }

  private charge = (name: string, count = 1): void => {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid priority work charge")
    if (this.iterations + count > this.MAX_ITERATIONS)
      throw new PriorityWorkLimitReached()
    this.iterations += count
    this.record(name, count)
    this.record("priorityWorkUnits", count)
  }

  private unknown(reason: string): void {
    this.failed = true
    // Exhausting this proposal policy is never a geometric UNSAT result.
    this.error = `Priority DAG candidate UNKNOWN: ${reason}`
    this.recordTerminal(false)
  }

  private recordTerminal(solved: boolean): void {
    if (this.terminalRecorded)
      throw new Error("Duplicate priority terminal accounting")
    this.terminalRecorded = true
    for (const [key, value] of Object.entries({
      priorityCompletedCandidates: 1,
      prioritySolvedCandidates: Number(solved),
      priorityUnknownCandidates: Number(!solved),
      priorityCompletedWorkUnits: this.iterations,
    })) {
      this.priorityDiagnostics[key] =
        (this.priorityDiagnostics[key] ?? 0) + value
      if (this.aggregate)
        this.aggregate[key] = (this.aggregate[key] ?? 0) + value
    }
  }

  private acceptState(state: State): void {
    this.charge("priorityStateSelections")
    // Immutable private witnesses are safe to retain only under EXACT ancestor
    // identities AND their route-witness identities. The future list is exactly
    // the canonical complement, so the same membership proves its identity.
    for (let task = 0; task < this.tasks.length; task++) {
      const witness = state.witnesses[task]
      if (!witness) continue
      this.charge("priorityRetainedContextChecks", this.tasks.length)
      if (
        witness.ancestors.length !== state.ancestors[task].size ||
        witness.ancestors.some(
          ([i, route]) =>
            !state.ancestors[task].has(i) || state.witnesses[i] !== route,
        )
      )
        throw new Error("Stale retained priority witness")
      this.record("priorityWitnessesRetained")
    }
    this.current = state
    this.todo = this.tasks
      .map((_, i) => i)
      .filter((i) => !state.witnesses[i])
      .sort((a, b) => {
        this.charge("priorityTopologicalComparisons")
        return state.ancestors[a].size - state.ancestors[b].size || a - b
      })
    this.pairLeft = 0
    this.pairRight = 1
    this.finalTask = 0
    this.readyToValidate = false
  }

  private getOptions(
    task: number,
    state: State,
  ): ConstructorParameters<typeof Native>[0] {
    const ancestors = state.ancestors[task]
    const obstacleRoutes: HighDensityIntraNodeRoute[] = []
    const futureConnections: Task[] = []
    for (let i = 0; i < this.tasks.length; i++) {
      this.charge("priorityContextEntries")
      if (ancestors.has(i)) {
        const witness = state.witnesses[i]
        if (!witness)
          throw new Error("Missing higher-priority physical witness")
        if (this.owner[i] !== this.owner[task])
          obstacleRoutes.push(witness.route)
      } else if (i !== task) futureConnections.push(this.tasks[i])
    }
    return {
      ...this.tasks[task],
      A: this.tasks[task].points[0],
      B: this.tasks[task].points[1],
      regionId: this.regionId,
      obstacleRoutes,
      futureConnections,
      bounds: this.nativeBounds,
      minDistBetweenEnteringPoints: this.minDistBetweenEnteringPoints,
      layerCount: this.board.layerCount,
      availableZ: this.allowedLayers,
      hyperParameters: this.hyperParameters,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceThickness: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      captureSearchDebug: this.captureSearchDebug,
    }
  }

  protected override getSingleRouteSolverOpts(
    connection: Task,
  ): ConstructorParameters<typeof Native>[0] {
    // Reuse native fast-via handling with the already charged CURRENT indexed
    // branch context, never inherited total-order globals or a renamed net.
    if (connection !== this.tasks[this.currentTask] || !this.nativeTaskOptions)
      throw new Error("Unknown priority native helper context")
    return this.nativeTaskOptions
  }

  private startTask(task: number, state: State): void {
    const opts = this.getOptions(task, state)
    const setupPrimitives =
      1 +
      opts.obstacleRoutes.reduce(
        (sum, r) => sum + r.route.length + r.vias.length,
        0,
      ) +
      (opts.futureConnections ?? []).reduce(
        (sum, t) => sum + t.points.length,
        0,
      )
    this.currentTask = task
    if (
      opts.A.x === opts.B.x &&
      opts.A.y === opts.B.y &&
      opts.A.z !== opts.B.z
    ) {
      this.charge("priorityEndpointViaSetupPrimitives", setupPrimitives)
      this.charge("priorityEndpointViaGuardUpperBound", 2)
      this.record("priorityEndpointViaAttempts")
      this.nativeTaskOptions = opts
      let accepted: boolean
      try {
        accepted = super.trySolveSamePointLayerChange(this.tasks[task])
      } finally {
        this.nativeTaskOptions = undefined
      }
      if (accepted) {
        const route = this.solvedRoutes.pop()
        if (!route || this.solvedRoutes.length !== 0)
          throw new Error("Invalid native endpoint-via temporary witness")
        this.storeRoute(route, state, task)
        this.record("priorityEndpointViaAccepted")
        return
      }
    }
    // As in native Intra, a rejected endpoint-via test continues to the SAME
    // native Single search. Both constructions and the failed check are paid.
    this.charge("priorityNativeSetupPrimitives", setupPrimitives)
    this.activeSubSolver = new Native(opts)
    this.record("priorityNativeSearches")
  }

  private storeRoute(
    route: HighDensityIntraNodeRoute,
    state: State,
    task: number,
  ): void {
    this.charge(
      "priorityWitnessCopies",
      1 + route.route.length + route.vias.length + state.ancestors[task].size,
    )
    const expected = this.tasks[task]
    const start = route.route[0],
      end = route.route.at(-1)
    if (
      route.connectionName !== expected.connectionName ||
      route.rootConnectionName !== expected.rootConnectionName ||
      route.regionId !== this.regionId ||
      route.traceThickness !== this.traceWidth ||
      route.viaDiameter !== this.viaDiameter ||
      !start ||
      !end ||
      start.x !== expected.points[0].x ||
      start.y !== expected.points[0].y ||
      start.z !== expected.points[0].z ||
      end.x !== expected.points[1].x ||
      end.y !== expected.points[1].y ||
      end.z !== expected.points[1].z
    )
      throw new Error("Invalid priority native route identity")
    const copy = {
      ...route,
      route: route.route.map((p) => Object.freeze({ ...p })),
      vias: route.vias.map((v) => Object.freeze({ ...v })),
    }
    Object.freeze(copy.route)
    Object.freeze(copy.vias)
    Object.freeze(copy)
    state.witnesses[task] = {
      route: copy,
      ancestors: [...state.ancestors[task]].map((i) => {
        const witness = state.witnesses[i]
        if (!witness) throw new Error("Missing priority route context")
        return [i, witness]
      }),
    }
  }

  private pairConflict(left: number, right: number, state: State): boolean {
    this.charge("priorityPairChecks")
    const a = state.witnesses[left]?.route,
      b = state.witnesses[right]?.route
    if (!a || !b) throw new Error("Missing priority pair witness")
    // Drill clearance is owner-independent; only an identical same-net site
    // denotes reuse. Never replace the actual drill gap by annulus clearance.
    for (const va of a.vias)
      for (const vb of b.vias) {
        this.charge("priorityDrillPairChecks")
        const distance = Math.hypot(va.x - vb.x, va.y - vb.y)
        if (distance === 0 && this.owner[left] === this.owner[right]) continue
        if (distance < this.viaHoleDiameter + this.minimumHoleGap) return true
      }
    if (this.owner[left] === this.owner[right]) return false
    this.charge(
      "priorityGeometrySetupUpperBound",
      a.route.length + a.vias.length + b.route.length + b.vias.length,
    )
    const x = getPipeline9RouteCopperGeometry(a, this.board),
      y = getPipeline9RouteCopperGeometry(b, this.board)
    // Conservatively charge every potential physical primitive comparison,
    // including those the exact function may skip after an early collision.
    this.charge(
      "priorityPairPrimitiveUpperBound",
      (x.wireSegments.length + x.viaSpans.length) *
        (y.wireSegments.length + y.viaSpans.length),
    )
    return doPipeline9RoutesHaveCopperConflict({
      left: a,
      right: b,
      clearance: this.obstacleMargin,
      ...this.board,
    })
  }

  private branch(left: number, right: number, state: State): void {
    this.record("priorityObservedConflicts")
    for (const [higher, lower] of [
      [right, left],
      [left, right],
    ]) {
      const child = extendPriorityDag(state, higher, lower, this.charge)
      if (!child) {
        this.record("priorityCyclicOrExistingBranches")
        continue
      }
      this.charge("priorityStateKeyEntries", this.tasks.length ** 2)
      const key = child.ancestors
        .map((set) => [...set].sort((a, b) => a - b).join(","))
        .join(";")
      if (this.visited.has(key)) {
        this.record("priorityDuplicateStates")
        continue
      }
      this.visited.add(key)
      this.stack.push(child)
      this.record("priorityStatesQueued")
    }
    this.current = undefined
  }

  private validateRoute(task: number, state: State): boolean {
    const witness = state.witnesses[task]
    if (!witness) throw new Error("Missing final priority route")
    for (let i = 0; i < witness.route.vias.length; i++)
      for (let j = i + 1; j < witness.route.vias.length; j++) {
        this.charge("priorityFinalDrillPairs")
        const a = witness.route.vias[i],
          b = witness.route.vias[j]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (
          distance > 0 &&
          distance < this.viaHoleDiameter + this.minimumHoleGap
        )
          return false
      }
    const opts = this.getOptions(task, state)
    this.charge(
      "priorityValidationSetupPrimitives",
      1 +
        opts.obstacleRoutes.reduce(
          (sum, r) => sum + r.route.length + r.vias.length,
          0,
        ) +
        (opts.futureConnections ?? []).reduce(
          (sum, t) => sum + t.points.length,
          0,
        ),
    )
    const checker = new Native(opts)
    let parent: Node | null = null
    for (let i = 0; i < witness.route.route.length; i++) {
      this.charge("priorityWitnessVertices")
      const point = witness.route.route[i]
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isSafeInteger(point.z)
      )
        throw new Error("Nonfinite priority route")
      const node: Node = { ...point, g: 0, h: 0, f: 0, parent }
      if (parent) {
        if (node.z !== parent.z) {
          this.charge("priorityFinalViaChecks")
          if (
            checker.isNodeTooCloseToObstacle(
              node,
              this.viaDiameter / 2 + this.obstacleMargin / 2,
              true,
            ) ||
            checker.isNodeTooCloseToEdge(node, true)
          )
            return false
        } else {
          this.charge("priorityFinalSegmentChecks")
          if (checker.doesPathToParentIntersectObstacle(node)) return false
          const initialMarker =
            node.x === opts.A.x && node.y === opts.A.y && node.z === opts.A.z
          if (i < witness.route.route.length - 1 && !initialMarker) {
            this.charge("priorityFinalPointChecks")
            if (
              checker.isNodeTooCloseToObstacle(node) ||
              checker.isNodeTooCloseToEdge(node, false)
            )
              return false
          }
        }
      }
      parent = node
    }
    return true
  }

  override _step(): void {
    // Replace BaseSolver's one-call clock with the explicit aggregate work
    // clock below, bounded by exactly the removed native family allowance.
    this.iterations--
    try {
      this.charge("priorityDispatches")
      if (this.activeSubSolver) {
        this.charge("priorityNativeSteps")
        this.activeSubSolver.step()
        if (this.activeSubSolver.failed) {
          this.record("priorityUnknownLowLevelSearches")
          this.record("priorityStatesAbandonedLowLevel")
          this.activeSubSolver = null
          this.current = undefined
        } else if (this.activeSubSolver.solved) {
          if (!this.current || !this.activeSubSolver.solvedPath)
            throw new Error("Missing completed priority plan")
          this.storeRoute(
            this.activeSubSolver.solvedPath,
            this.current,
            this.currentTask,
          )
          this.activeSubSolver = null
        }
        return
      }
      if (!this.current) {
        const state = this.stack.pop()
        if (!state) {
          this.unknown(
            "bounded priority policy exhausted; no physical impossibility proven",
          )
          return
        }
        this.acceptState(state)
      }
      const state = this.current!
      const task = this.todo.shift()
      if (task !== undefined) {
        this.startTask(task, state)
        return
      }
      if (!this.readyToValidate) {
        if (this.pairLeft < this.tasks.length - 1) {
          const left = this.pairLeft,
            right = this.pairRight
          if (this.pairConflict(left, right, state)) {
            this.branch(left, right, state)
            return
          }
          this.pairRight++
          if (this.pairRight === this.tasks.length) {
            this.pairLeft++
            this.pairRight = this.pairLeft + 1
          }
          return
        }
        this.readyToValidate = true
      }
      if (this.finalTask < this.tasks.length) {
        if (!this.validateRoute(this.finalTask++, state)) {
          this.record("priorityRejectedFinalWitnesses")
          this.current = undefined
        }
        return
      }
      this.charge(
        "priorityOutputCopies",
        state.witnesses.reduce(
          (sum, w) => sum + 1 + w!.route.route.length + w!.route.vias.length,
          0,
        ),
      )
      this.solvedRoutes = state.witnesses.map((w) => ({
        ...w!.route,
        route: w!.route.route.map((p) => ({ ...p })),
        vias: w!.route.vias.map((v) => ({ ...v })),
      }))
      this.solved = true
      this.recordTerminal(true)
    } catch (error) {
      if (!(error instanceof PriorityWorkLimitReached)) throw error
      this.unknown("aggregate family work allowance exhausted")
    }
    this.progress = this.current
      ? this.current.witnesses.filter(Boolean).length / this.tasks.length
      : 0
  }

  override computeProgress(): number {
    if (this.solved) return 1
    const state = this.current
    return state
      ? Math.min(
          0.99,
          state.witnesses.filter(Boolean).length / this.tasks.length,
        )
      : 0
  }
}

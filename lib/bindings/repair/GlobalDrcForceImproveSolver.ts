import { getGlobalDrcForceImproveSolverVisualizer } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/globalDrcForceImproveSolverVisualizer"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import { getBaseMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { cloneRoutes, materializeRoutes, getDrcSnapshot, getTopologyRepairDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import type { DrcEvaluator } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/types"
import type { SimpleRouteJson } from "high-density-repair03/lib/types"
import type { GlobalDrcForceImproveSolverParams, HighDensityRoute, DrcSnapshot } from "high-density-repair03/lib"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../initializeAutorouterBindings"

type RoutePacket = bindings.GlobalDrcRoutePacket
type SolverStateSnapshot = bindings.GlobalDrcSolverState

type MutationGraph = {
  value: object
  keys: string[]
  values: unknown[]
  children: Array<MutationGraph | undefined>
  arrayLength: number | undefined
  comparable: boolean
  comparedAt: number
}

let activeOwner: GlobalDrcForceImproveSolver | undefined

function copyMetadata<T extends object>(source: T | undefined, value: T): T {
  if (!source) return value
  const result = { ...source, ...value }
  for (const key of Object.keys(source)) {
    const previous = Reflect.get(source, key)
    if (!(key in value) && previous !== undefined) Reflect.deleteProperty(result, key)
    else if (key !== "route" && key !== "vias" && previous !== null && typeof previous === "object") Reflect.set(result, key, previous)
  }
  return result
}

export class GlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly inputHdRoutes: HighDensityRoute[]
  readonly guardedInputHdRoutes: HighDensityRoute[]
  readonly connMap?: ConnectivityMap
  readonly effort: number
  readonly drcEvaluator?: DrcEvaluator
  readonly referenceDrcEvaluator?: DrcEvaluator
  readonly autoroutingDrcEngine?: AutoroutingDrcEngine
  readonly viaHoleDiameter?: number
  readonly configuredMaxIterations?: number
  readonly enableBroadFallback: boolean
  readonly enableLargeBoardBroadFallback: boolean
  readonly enableTargetedErrorSweep: boolean
  readonly enablePostSolveClearanceRelaxation: boolean
  readonly enableSafeTraceLayerMoves: boolean
  readonly enableViaInPadLayerMoves: boolean
  readonly enableTraceViaOwnerTargeting: boolean
  outputHdRoutes: HighDensityRoute[]
  private initialDrcIssueCount: number | undefined
  private initialRepairDrcIssueCount: number | undefined
  private initialLowCountErrorsHaveMovableTraces = false
  private broadForceAccepted = false
  private targetedForceAccepted = false
  private candidateAttempts = 0
  private viaInPadCandidateAttempts = 0
  private viaInPadCandidatesAccepted = 0
  private padTopologyErrorCursor = 0
  private safeTraceLayerCursorByErrorId = new Map<string, number>()
  private traceLayerCorridorCursorByErrorId = new Map<string, number>()
  private tracePairDetourCursorByErrorId = new Map<string, number>()
  private errorCursor = 0
  private stalledIterations = 0
  private bestDrcIssueCountSeen: number | undefined
  private bestDrcIssueScoreSeen: number | undefined
  private lastDrcCountImprovementCheckIteration = 0
  private drcCountPlateauChecks = 0
  private largeBoardBroadFallbackMisses = 0
  private outputSnapshot: DrcSnapshot | undefined
  private legacyCleanCheckpoint:
    | { routes: HighDensityRoute[]; snapshot: DrcSnapshot }
    | undefined
  private viaPadRepairRolledBack = false
  private referenceInputDrcIssueCount?: number
  private referenceCandidateDrcIssueCount?: number
  private referenceCandidateRolledBack = false
  private referenceInputSnapshot?: {
    errors: Array<Record<string, unknown>>
    count: number
  }
  private inputSnapshot?: DrcSnapshot


  private binding: bindings.GlobalDrcForceImproveSolver | undefined
  private readonly constructionParams: GlobalDrcForceImproveSolverParams
  private readonly routeArrays = new Map<number, HighDensityRoute[]>()
  private readonly arrayIds = new WeakMap<HighDensityRoute[], number>()
  private readonly routeObjects = new Map<number, HighDensityRoute>()
  private readonly points = new Map<number, HighDensityRoute["route"][number]>()
  private readonly pointArrays = new Map<number, HighDensityRoute["route"]>()
  private readonly viaArrays = new Map<number, HighDensityRoute["vias"]>()
  private readonly routeIds = new WeakMap<HighDensityRoute, number>()
  private readonly pointIds = new WeakMap<HighDensityRoute["route"][number], number>()
  private readonly pointArrayIds = new WeakMap<HighDensityRoute["route"], number>()
  private readonly viaArrayIds = new WeakMap<HighDensityRoute["vias"], number>()
  private readonly fingerprints = new Map<number, string>()
  private readonly mutationGraphs = new Map<number, MutationGraph>()
  private mutationComparison = 0
  private nextClientId = -1
  private callbackError: unknown
  private callbackThrew = false
  private outputMirror: HighDensityRoute[]
  private outputObserved = false
  private outputStale = true
  private outputDirty = false
  private inCallback = false
  private connectivityJson: string | undefined

  constructor(params: GlobalDrcForceImproveSolverParams) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.guardedInputHdRoutes = materializeRoutes(cloneRoutes(params.hdRoutes))
    this.connMap = params.connMap
    this.effort = params.effort ?? 1
    this.drcEvaluator = params.drcEvaluator
    this.referenceDrcEvaluator = params.referenceDrcEvaluator
    this.autoroutingDrcEngine =
      params.autoroutingDrcEngine ??
      (params.drcEvaluator
        ? undefined
        : new AutoroutingDrcEngine(params.srj, {
            connMap: params.connMap,
            traceClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.traceClearance,
            viaClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.viaClearance,
            includeTraceViaOwnerMetadata:
              params.enableTraceViaOwnerTargeting ?? false,
          }))
    if (
      params.viaHoleDiameter !== undefined &&
      (!Number.isFinite(params.viaHoleDiameter) || params.viaHoleDiameter <= 0)
    ) {
      throw new Error("viaHoleDiameter must be a positive finite number")
    }
    this.viaHoleDiameter = params.viaHoleDiameter
    this.configuredMaxIterations = params.maxIterations
    this.enableBroadFallback = params.enableBroadFallback ?? true
    this.enableLargeBoardBroadFallback =
      params.enableLargeBoardBroadFallback ?? true
    this.enableTargetedErrorSweep = params.enableTargetedErrorSweep ?? false
    this.enablePostSolveClearanceRelaxation =
      params.enablePostSolveClearanceRelaxation ?? true
    this.enableSafeTraceLayerMoves = params.enableSafeTraceLayerMoves ?? false
    this.enableViaInPadLayerMoves = params.enableViaInPadLayerMoves ?? false
    this.enableTraceViaOwnerTargeting =
      params.enableTraceViaOwnerTargeting ?? false
    this.outputHdRoutes = params.hdRoutes
    if (this.referenceDrcEvaluator) {
      this.referenceInputSnapshot = this.getReferenceDrcSnapshot(
        this.inputHdRoutes,
      )
    }
    this.MAX_ITERATIONS =
      this.configuredMaxIterations ?? getBaseMaxIterations(this.effort)
    this.constructionParams = params
    this.outputMirror = this.outputHdRoutes
    Object.defineProperty(this, "outputHdRoutes", {
      configurable: true, enumerable: true,
      get: (): HighDensityRoute[] => {
        if (this.binding && this.outputStale && !this.inCallback && !this.outputDirty) {
          this.outputMirror = this.readRoutes("output")
          this.outputStale = false
        }
        this.outputObserved = true
        return this.outputMirror
      },
      set: (routes: HighDensityRoute[]): void => { this.outputMirror = routes; this.outputDirty = true; this.outputStale = false },
    })
  }

  override getConstructorParams(): ReturnType<import("high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/GlobalDrcForceImproveSolver").GlobalDrcForceImproveSolver["getConstructorParams"]> {
    return [
      {
        srj: this.srj,
        hdRoutes: this.inputHdRoutes,
        connMap: this.connMap,
        effort: this.effort,
        drcEvaluator: this.drcEvaluator,
        referenceDrcEvaluator: this.referenceDrcEvaluator,
        autoroutingDrcEngine: this.autoroutingDrcEngine,
        viaHoleDiameter: this.viaHoleDiameter,
        maxIterations: this.configuredMaxIterations,
        enableBroadFallback: this.enableBroadFallback,
        enableLargeBoardBroadFallback: this.enableLargeBoardBroadFallback,
        enableTargetedErrorSweep: this.enableTargetedErrorSweep,
        enablePostSolveClearanceRelaxation:
          this.enablePostSolveClearanceRelaxation,
        enableSafeTraceLayerMoves: this.enableSafeTraceLayerMoves,
        enableViaInPadLayerMoves: this.enableViaInPadLayerMoves,
        enableTraceViaOwnerTargeting: this.enableTraceViaOwnerTargeting,
      },
    ] as const
  }

  private getSnapshot(routes: HighDensityRoute[]): DrcSnapshot {
    const createSnapshot = this.initialLowCountErrorsHaveMovableTraces
      ? getTopologyRepairDrcSnapshot
      : getDrcSnapshot
    return createSnapshot(
      this.srj,
      routes,
      this.drcEvaluator,
      this.connMap,
      this.autoroutingDrcEngine,
    )
  }

  private getReferenceDrcSnapshot(routes: HighDensityRoute[]): DrcSnapshot | { errors: Array<Record<string, unknown>>; count: number } {
    const evaluatorInput = {
      traces: [],
      srj: this.srj,
      routes,
      hdRoutes: routes,
    }
    const cachedResult =
      this.referenceDrcEvaluator?.getCachedResult?.(evaluatorInput)
    if (cachedResult) {
      const errors = Array.isArray(cachedResult)
        ? cachedResult
        : cachedResult.errors
      return { errors, count: errors.length }
    }
    return getDrcSnapshot(
      this.srj,
      routes,
      this.referenceDrcEvaluator,
      this.connMap,
      this.autoroutingDrcEngine,
    )
  }

  private static evaluateCallback(input: bindings.GlobalDrcCallbackInput): bindings.GlobalDrcCallbackOutput {
    const owner = activeOwner
    if (!owner) throw new Error("Global DRC callback outside its solver scope")
    owner.synchronizeState(input.state)
    const routes = owner.materialize(input.routes)
    if (input.output) { owner.outputMirror = owner.materialize(input.output); owner.outputStale = false }
    owner.inCallback = true
    try {
      const name = input.reference ? "getReferenceDrcSnapshot" : "getSnapshot"
      const method = Reflect.get(GlobalDrcForceImproveSolver.prototype, name) as (routes: HighDensityRoute[]) => DrcSnapshot
      const result = method.call(owner, routes)
      const snapshot = {
        errors: result.errors, count: result.count,
        issueScore: result.issueScore ?? 0, legacyIssueScore: result.legacyIssueScore ?? 0,
        traceRouteIndexById: Object.fromEntries(result.traceRouteIndexById ?? []),
      }
      return { snapshot, state: owner.mutationState(), mutations: owner.captureMutations() }
    } catch (error) {
      owner.callbackThrew = true
      owner.callbackError = error
      return { thrown:true, state:owner.mutationState(), mutations:owner.captureMutations() }
    } finally { owner.inCallback = false }
  }

  private getBinding(): bindings.GlobalDrcForceImproveSolver {
    if (this.binding) return this.binding
    initializeAutorouterBindings()
    const { drcEvaluator, referenceDrcEvaluator, autoroutingDrcEngine, connMap, ...params } = this.constructionParams
    const input = {
      ...params, connMap: connMap ? { idToNetMap: connMap.idToNetMap } : null,
      hasCustomDrcEvaluator: drcEvaluator !== undefined,
      useHostEvaluator: drcEvaluator !== undefined || autoroutingDrcEngine !== undefined,
      hasReferenceEvaluator: referenceDrcEvaluator !== undefined,
      initialReferenceSnapshot: Reflect.get(this, "referenceInputSnapshot"),
    }
    this.connectivityJson = JSON.stringify(input.connMap)
    this.binding = new bindings.GlobalDrcForceImproveSolver(input, GlobalDrcForceImproveSolver.evaluateCallback)
    this.bindInitial(this.binding.routes("input"), this.inputHdRoutes)
    this.bindInitial(this.binding.routes("guarded"), this.guardedInputHdRoutes)
    return this.binding
  }

  private bindInitial(packet: RoutePacket, routes: HighDensityRoute[]): void {
    this.routeArrays.set(packet.id, routes)
    this.arrayIds.set(routes, packet.id)
    for (const [index, item] of packet.routes.entries()) {
      const route = routes[index]
      if (!route) continue
      this.routeObjects.set(item.id, route)
      this.routeIds.set(route, item.id)
      this.pointArrayIds.set(route.route, item.pointArrayId)
      this.viaArrayIds.set(route.vias, item.viaArrayId)
      this.pointArrays.set(item.pointArrayId, route.route)
      this.viaArrays.set(item.viaArrayId, route.vias)
      for (const [pointIndex, id] of item.pointIds.entries()) {
        const point = route.route[pointIndex]
        if (!point) continue
        this.points.set(id, point)
        this.pointIds.set(point, id)
      }
    }
    this.fingerprints.set(packet.id, JSON.stringify({ id: packet.id, routes: packet.routes.map(item => ({
      id: item.id, value: item.value, pointArrayId: item.pointArrayId, viaArrayId: item.viaArrayId, pointIds: item.pointIds,
    })) }))
    this.mutationGraphs.set(packet.id, this.snapshotMutationGraph(routes))
  }

  private materialize(packet: RoutePacket): HighDensityRoute[] {
    const routes = packet.routes.map((item) => {
      const retained = this.routeObjects.get(item.id)
      const source = this.routeObjects.get(item.sourceId)
      const value = copyMetadata(source, item.value)
      const route = retained ?? value
      const points = item.value.route.map((point, index) => {
        const id = item.pointIds[index]!
        const retained = this.points.get(id)
        const value = copyMetadata(this.points.get(item.pointSourceIds[index]!), point)
        const result = retained ?? value
        if (retained) this.updateObject(retained, value)
        this.points.set(id,result);this.pointIds.set(result,id)
        return result
      })
      const pointArray = this.pointArrays.get(item.pointArrayId) ?? []
      pointArray.splice(0,pointArray.length,...points)
      this.pointArrays.set(item.pointArrayId,pointArray);this.pointArrayIds.set(pointArray,item.pointArrayId)
      value.route=pointArray
      const vias=this.viaArrays.get(item.viaArrayId) ?? item.value.vias
      value.vias=vias
      this.viaArrays.set(item.viaArrayId,vias);this.viaArrayIds.set(vias,item.viaArrayId)
      if(retained)this.updateObject(retained,value)
      this.routeObjects.set(item.id,route);this.routeIds.set(route,item.id)
      return route
    })
    const result=this.routeArrays.get(packet.id) ?? []
    result.splice(0,result.length,...routes)
    this.routeArrays.set(packet.id,result);this.arrayIds.set(result,packet.id)
    this.fingerprints.set(packet.id,JSON.stringify(this.encodeArray(packet.id,result)))
    this.mutationGraphs.set(packet.id, this.snapshotMutationGraph(result))
    return result
  }

  private updateObject(target: object,value: object):void {
    for(const key of Object.keys(target))if(!(key in value))Reflect.deleteProperty(target,key)
    for(const [key,entry]of Object.entries(value))Reflect.set(target,key,entry)
  }

  private clientIdentity<T extends object>(map:WeakMap<T,number>,value:T):number {
    const existing=map.get(value)
    if(existing!==undefined)return existing
    const id=this.nextClientId--
    map.set(value,id)
    return id
  }

  private encodeArray(id:number,routes:HighDensityRoute[]):bindings.GlobalDrcMutationPacket {
    return {id,routes:routes.map(route=>{
      const id=this.clientIdentity(this.routeIds,route)
      this.routeObjects.set(id,route)
      return {id,value:route,pointArrayId:this.clientIdentity(this.pointArrayIds,route.route),viaArrayId:this.clientIdentity(this.viaArrayIds,route.vias),
        pointIds:route.route.map(point=>{const id=this.clientIdentity(this.pointIds,point);this.points.set(id,point);return id})}
    })}
  }

  private snapshotMutationGraph(value: object, seen = new WeakMap<object, MutationGraph>()): MutationGraph {
    const existing = seen.get(value)
    if (existing) return existing
    const prototype = Object.getPrototypeOf(value)
    const comparable = (Array.isArray(value) || prototype === Object.prototype || prototype === null)
      && !("toJSON" in value)
    const graph: MutationGraph = {
      value, keys: [], values: [], children: [],
      arrayLength: Array.isArray(value) ? value.length : undefined,
      comparable, comparedAt: 0,
    }
    seen.set(value, graph)
    if (!comparable) return graph
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!Object.hasOwn(descriptor, "value")) {
        graph.comparable = false
        return graph
      }
      const entry: unknown = descriptor.value
      graph.keys.push(key)
      graph.values.push(entry)
      graph.children.push(entry !== null && typeof entry === "object"
        ? this.snapshotMutationGraph(entry, seen) : undefined)
    }
    return graph
  }

  private mutationGraphMatches(graph: MutationGraph, value: object, comparison: number): boolean {
    if (!graph.comparable || graph.value !== value || "toJSON" in value) return false
    if (graph.comparedAt === comparison) return true
    graph.comparedAt = comparison
    if (Array.isArray(value) && value.length !== graph.arrayLength) return false
    let index = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (key !== graph.keys[index]) return false
      const entry: unknown = Reflect.get(value, key)
      if (!Object.is(entry, graph.values[index])) return false
      const child = graph.children[index]
      if (child && !this.mutationGraphMatches(child, entry as object, comparison)) return false
      index++
    }
    return index === graph.keys.length
  }

  private captureMutations():bindings.GlobalDrcMutationPacket[] {
    const mutations:bindings.GlobalDrcMutationPacket[]=[]
    for(const [id,routes]of this.routeArrays) {
      const graph = this.mutationGraphs.get(id)
      if (graph && this.mutationGraphMatches(graph, routes, ++this.mutationComparison)) continue
      const packet=this.encodeArray(id,routes),json=JSON.stringify(packet)
      if(json!==this.fingerprints.get(id)) { mutations.push(packet);this.fingerprints.set(id,json) }
      this.mutationGraphs.set(id, this.snapshotMutationGraph(routes))
    }
    return mutations
  }

  private mutationState():SolverStateSnapshot {
    const state=this.publicState()
    if(this.outputDirty) {
      const id=this.clientIdentity(this.arrayIds,this.outputMirror)
      this.routeArrays.set(id,this.outputMirror)
      state.outputId=id
      this.outputDirty=false
    }
    return state
  }

  private readRoutes(which: string): HighDensityRoute[] {
    return this.materialize(this.binding!.routes(which))
  }

  private publicState(): SolverStateSnapshot {
    return { iterations: this.iterations, MAX_ITERATIONS: this.MAX_ITERATIONS, solved: this.solved,
      failed: this.failed, error: this.error, progress: this.progress, stats: this.stats }
  }

  private synchronizeState(state: SolverStateSnapshot): void {
    for (const [key, value] of Object.entries(state)) {
      if (key === "outputIsInput" || key === "drcStats") continue
      const old = Reflect.get(this, key)
      if (old instanceof Map && value && typeof value === "object") {
        old.clear()
        for (const [id, item] of Object.entries(value)) old.set(id, item)
      } else Reflect.set(this, key, value)
    }
    if (state.drcStats && this.autoroutingDrcEngine) this.autoroutingDrcEngine.lastRunStats = state.drcStats
  }

  private runSolver(finalAcceptance: boolean): void {
    const previous = activeOwner
    activeOwner = this
    try {
      const binding = this.getBinding()
      const state = this.mutationState()
      state.mutations=this.captureMutations()
      const connectivity = this.connMap ? { idToNetMap: this.connMap.idToNetMap } : null
      const connectivityJson = JSON.stringify(connectivity)
      if (connectivityJson !== this.connectivityJson) {
        state.connectivity = connectivity
        this.connectivityJson = connectivityJson
      }
      this.synchronizeState(binding.stepInner(state, finalAcceptance))
      this.outputStale = true
      if (this.outputObserved) {
        this.outputMirror = this.readRoutes("output")
        this.outputStale = false
      }
    } catch(error) {
      if(this.callbackThrew) {
        const original=this.callbackError
        this.callbackError=undefined;this.callbackThrew=false
        throw original
      }
      throw error
    } finally { activeOwner = previous }
  }

  override _step(): void { this.runSolver(false) }
  override tryFinalAcceptance(): void { this.runSolver(true) }
  override getOutput(): HighDensityRoute[] { return this.outputHdRoutes }

  override visualize(): GraphicsObject {
    const visualizer = getGlobalDrcForceImproveSolverVisualizer()
    return (visualizer ? Reflect.apply(visualizer, undefined, [this]) : undefined) ?? super.visualize()
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}

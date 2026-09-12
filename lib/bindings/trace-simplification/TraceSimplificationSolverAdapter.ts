import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import type { ObstacleSpatialHashIndex } from "../../data-structures/ObstacleTree"
import { BaseSolver } from "../../solvers/BaseSolver"
import { TraceSimplificationGraphCodec } from "lib/bindings/trace-simplification/TraceSimplificationGraphCodec"

type SolverAdapterClass = { prototype: TraceSimplificationSolverAdapter; solverKind: string; stateFields: readonly string[] }
const childConstructors = new Map<string, SolverAdapterClass>()
const queryGraphIds = new WeakMap<TraceSimplificationGraphCodec, number>()
const activeQueryGraphs = new Map<number, TraceSimplificationGraphCodec>()
let nextQueryGraphId = 1

function withQueryGraph<T>(graph: TraceSimplificationGraphCodec, run: () => T): T {
  let id = queryGraphIds.get(graph)
  if (id === undefined) { id = nextQueryGraphId++; queryGraphIds.set(graph, id) }
  const previous = activeQueryGraphs.get(id)
  activeQueryGraphs.set(id, graph)
  graph.beginConnectivityOperation()
  try { return run() }
  finally { graph.endConnectivityOperation(); if (previous) activeQueryGraphs.set(id, previous); else activeQueryGraphs.delete(id) }
}

export class TraceSimplificationSolverAdapter extends BaseSolver {
  static solverKind = ""
  static stateFields: readonly string[] = []
  protected binding!: bindings.TraceSimplificationDispatcher
  protected graph!: TraceSimplificationGraphCodec
  protected readonly stateValues: Record<string, any> = {}
  protected observed = false
  private statsObserved = false
  private outputValues: Record<string, any> = {}
  private syncingSolver = false
  private dirtyBase = false
  private hasSnapshot = false
  private readonly dirtyFields = new Set<string>()
  private readonly baseValues: Record<string, any> = {}
  private childViews = new Map<number, TraceSimplificationSolverAdapter>()
  protected sourceParams: Record<string, any>

  static register(kind: string, ctor: SolverAdapterClass): void { childConstructors.set(kind, ctor) }

  constructor(params: Record<string, any>) {
    super()
    this.sourceParams = params
    initializeAutorouterBindings()
    this.graph = new TraceSimplificationGraphCodec()
    const ctor = new.target as SolverAdapterClass
    const paramsGraph = this.graph.graph(params)
    this.binding = TraceSimplificationSolverAdapter.createBinding(ctor.solverKind, paramsGraph, this.graph)
    const normalizedObstacles = ["multi-path", "via-removal", "via-merger", "trace"].includes(ctor.solverKind)
      ? this.hydrateSolver(this.binding.obstacles()) : undefined
    if (["via-merger", "crossing"].includes(ctor.solverKind)) this.hydrateSolver(this.binding.output())
    this.graph.trackSources(normalizedObstacles ? { ...params, __normalizedObstacles: normalizedObstacles } : params, ctor.solverKind)
    if (normalizedObstacles && ctor.stateFields.includes("obstacles")) this.stateValues.obstacles = normalizedObstacles
    if (ctor.solverKind === "trace") this.stateValues.simplificationConfig = { ...params, obstacles: normalizedObstacles }
    for (const field of ctor.stateFields) if (Object.hasOwn(params, field) && !(field === "hdRoutes" && ctor.solverKind === "trace") && !(field === "obstacles" && ["multi-path", "via-removal", "via-merger", "trace"].includes(ctor.solverKind))) this.stateValues[field] = params[field]
    this.installAccessors(ctor)
    this.syncBase()
  }

  private static createBinding(kind: string, params: bindings.TraceGraphPacket, graph: TraceSimplificationGraphCodec): bindings.TraceSimplificationDispatcher {
    return withQueryGraph(graph, () => new bindings.TraceSimplificationDispatcher(kind, params, TraceSimplificationSolverAdapter.createQueryCallback(queryGraphIds.get(graph)!), TraceSimplificationSolverAdapter.createConnectivityCallback(queryGraphIds.get(graph)!)))
  }

  private static createConnectivityCallback(graphId: number): (identity: number) => bindings.TraceConnectivityUpdate | undefined {
    return (identity: number): bindings.TraceConnectivityUpdate | undefined => {
      const graph = activeQueryGraphs.get(graphId)
      if (!graph) throw new Error("Connectivity read called outside native solver execution")
      return graph.connectivityForRead(identity)
    }
  }

  protected runSolver<T>(run: () => T): T { return withQueryGraph(this.graph, run) }

  private static createQueryCallback(graphId: number): (request: bindings.TraceObstacleQuery) => bindings.TraceGraphPacket {
    return (request: bindings.TraceObstacleQuery): bindings.TraceGraphPacket => {
      const graph = activeQueryGraphs.get(graphId)
      if (!graph) throw new Error("Obstacle query called outside native solver execution")
      graph.exposeNormalizedObstacles()
      const index = graph.objects.get(request.indexId) as ObstacleSpatialHashIndex | undefined
      if (!index) throw new Error(`Unknown obstacle index ${request.indexId}`)
      if (request.method === "search") {
        const [minX, minY, maxX, maxY] = request.args
        try { return graph.graph(index.search({ minX, minY, maxX, maxY })) }
        finally { graph.invalidateConnectivityReads() }
      }
      if (request.method === "searchArea") {
        const [x, y, width, height] = request.args
        try { return graph.graph(index.searchArea(x, y, width, height)) }
        finally { graph.invalidateConnectivityReads() }
      }
      throw new Error(`Unknown obstacle query ${request.method}`)
    }
  }

  private hydrateSolver(packet: bindings.TraceGraphPacket, current?: any): any {
    const value = this.graph.hydrate(packet, current)
    const groups = this.graph.takeCapturedCloneGroups()
    if (groups.length) this.binding.acknowledgeCloneGroups(groups)
    return value
  }

  private installAccessors(ctor: SolverAdapterClass): void {
    for (const field of ["MAX_ITERATIONS", "iterations", "solved", "failed", "error", "progress"]) {
      this.baseValues[field] = (this as unknown as Record<string, any>)[field]
      Object.defineProperty(this, field, { enumerable: true, configurable: true,
        get: (): any => this.baseValues[field],
        set: (value: any): void => { this.baseValues[field] = value; if (!this.syncingSolver) { this.dirtyBase = true; this.dirtyFields.add(field) } },
      })
    }
    if (!Object.hasOwn(this.stateValues, "stats")) this.stateValues.stats = this.stats
    const diagnosticFields = ctor.stateFields.includes("stats") ? ctor.stateFields : [...ctor.stateFields, "stats"]
    for (const field of diagnosticFields) Object.defineProperty(this, field, { enumerable: true, configurable: true,
      get: (): any => this.readSolverField(field),
      set: (value: any): void => {
        if (value !== null && typeof value === "object") this.readSolverField(field)
        this.stateValues[field] = value
        this.dirtyFields.add(field)
      },
    })
  }

  private syncBase(): void {
    this.syncingSolver = true
    try { Object.assign(this, this.binding.state()) }
    finally { this.syncingSolver = false; this.dirtyBase = false; this.dirtyFields.clear() }
  }

  private wrapChild(binding: bindings.TraceSimplificationDispatcher): TraceSimplificationSolverAdapter {
    const id = binding.identity()
    const existing = this.childViews.get(id)
    if (existing) { binding.free(); return existing }
    const ctor = childConstructors.get(binding.kind())
    if (!ctor) throw new Error(`Unregistered binding simplification child ${binding.kind()}`)
    const child = Object.create(ctor.prototype) as TraceSimplificationSolverAdapter
    Object.assign(child, new BaseSolver(), { binding: binding, graph: this.graph, stateValues: {}, outputValues: {}, observed: false, statsObserved: false, syncingSolver: false, dirtyBase: false, hasSnapshot: false, dirtyFields: new Set(), baseValues: {}, childViews: new Map(), sourceParams: this.sourceParams })
    child.installAccessors(ctor)
    child.syncBase()
    this.graph.register(id, child)
    this.childViews.set(id, child)
    return child
  }

  private registerChildTree(): void {
    const previous = this.stateValues.activeSubSolver
    const binding = this.binding.activeChild()
    if (!binding) {
      if (previous instanceof TraceSimplificationSolverAdapter) previous.sync()
      if ((this.constructor as unknown as SolverAdapterClass).stateFields.includes("activeSubSolver")) this.stateValues.activeSubSolver = null
      return
    }
    const child = this.wrapChild(binding)
    if (previous instanceof TraceSimplificationSolverAdapter && previous !== child) previous.sync()
    this.stateValues.activeSubSolver = child
    child.registerChildTree()
  }

  sync(): void {
    if (this.syncingSolver) return
    this.graph.exposeNormalizedObstacles()
    const sourceChanges = this.graph.sourceChanges()
    if (sourceChanges) this.binding.restore(sourceChanges)
    this.syncingSolver = true
    try {
      const snapshot = this.binding.snapshot()
      if (Object.hasOwn(snapshot.fields, "activeSubSolver")) {
        this.registerChildTree()
      }
      const fields = this.hydrateSolver(snapshot, this.stateValues)
      for (const [key, value] of Object.entries(fields)) {
        if (Object.hasOwn(this.baseValues, key)) { if (!this.dirtyBase) this.baseValues[key] = value }
        else if (key !== "activeSubSolver") this.stateValues[key] = value
      }
      this.hasSnapshot = true
    } finally { this.syncingSolver = false }
  }

  acceptSnapshotFields(fields: Record<string, unknown>): void {
    this.syncingSolver = true
    try {
      this.graph.decode(fields, this.stateValues)
      for (const key of Object.keys(this.baseValues)) if (Object.hasOwn(fields, key) && !this.dirtyBase) this.baseValues[key] = this.stateValues[key]
      this.hasSnapshot = true
    } finally { this.syncingSolver = false }
  }

  push(stepArguments = false, routingOnly = stepArguments): void {
    const sourceChanges = this.graph.sourceChanges(routingOnly)
    if (sourceChanges) this.binding.restore(sourceChanges)
    const dirtyFields = [...this.dirtyFields].filter(field => !stepArguments || (field !== "iterations" && field !== "MAX_ITERATIONS"))
    if (!this.observed && !this.statsObserved && dirtyFields.length === 0 && Object.keys(this.outputValues).length === 0) return
    const fields: Record<string, any> = { ...this.outputValues }
    if (this.observed) {
      Object.assign(fields, this.stateValues, this.baseValues)
    } else {
      for (const field of dirtyFields) {
        fields[field] = Object.hasOwn(this.baseValues, field)
          ? this.baseValues[field] : this.stateValues[field]
      }
      if (this.statsObserved) fields.stats = this.stateValues.stats
    }
    if (fields.activeSubSolver instanceof TraceSimplificationSolverAdapter) {
      fields.activeSubSolver.push(false, routingOnly)
      fields.activeSubSolver = { $object: fields.activeSubSolver.binding.identity(), fields: {} }
    }
    this.binding.restore(this.graph.graph(fields))
    this.dirtyBase = false
    this.dirtyFields.clear()
  }

  protected readSolverField(key: string): any {
    if (key === "stats" && !this.observed) {
      if (!this.statsObserved) { this.push(); this.hydrateSolver(this.binding.statistics(), this.stateValues); this.statsObserved = true }
      return this.stateValues.stats
    }
    this.graph.exposeNormalizedObstacles()
    if (!this.hasSnapshot) { this.push(); this.sync() }
    this.observed = true
    return this.stateValues[key]
  }

  protected canSolveInBindings(): boolean { return true }
  protected resolveSolverStep(status: number): number {
    if ((status & 8) !== 0) this.hydrateSolver(this.binding.initialization())
    return status
  }

  protected callSolver<A extends unknown[], R>(
    method: (args: bindings.TraceMethodGraph<A>) => bindings.TraceMethodGraph<R>,
    args: NoInfer<A>,
  ): R {
    this.graph.exposeNormalizedObstacles()
    this.push()
    const argsGraph: bindings.TraceMethodGraph<A> = this.graph.graph(args)
    this.graph.trackArguments(args)
    const value = this.hydrateSolver(withQueryGraph(this.graph, () => method.call(this.binding, argsGraph)))
    if (this.observed) this.sync()
    else if (this.statsObserved) this.hydrateSolver(this.binding.statistics(), this.stateValues)
    return value
  }

  private readOutput(track: boolean): any {
    if (track) this.graph.exposeNormalizedObstacles()
    const value = this.hydrateSolver(this.binding.output())
    switch ((this.constructor as unknown as SolverAdapterClass).solverKind) {
      case "path-base": case "path": case "vertex": this.outputValues = { newRoute: value.route, newVias: value.vias }; break
      case "multi-path": this.outputValues = { simplifiedHdRoutes: value }; break
      case "via-removal": this.outputValues = { optimizedHdRoutes: value }; break
      case "via-merger": this.outputValues = { mergedViaHdRoutes: value }; break
      case "trace": this.outputValues = { hdRoutes: value }; break
      case "crossing": this.outputValues = { reducedHdRoutes: value }; break
    }
    if (track) this.graph.trackArguments([value])
    return value
  }

  output(): any {
    this.push()
    return this.readOutput(true)
  }

  override _step(): void {
    this.push(true)
    let completed = false
    try {
      let status = withQueryGraph(this.graph, () => this.binding.step(this.iterations, this.MAX_ITERATIONS))
      status = this.resolveSolverStep(status)
      this.baseValues.solved = (status & 1) !== 0
      this.baseValues.failed = (status & 2) !== 0
      if (this.baseValues.failed) this.baseValues.error = this.binding.error() ?? null
      this.dirtyFields.clear(); this.dirtyBase = false
      completed = true
    } finally {
      if (!completed) this.syncBase()
      if (this.observed) this.sync()
      else if (this.statsObserved) this.hydrateSolver(this.binding.statistics(), this.stateValues)
      if (!this.observed && Object.keys(this.outputValues).length) this.readOutput(false)
    }
  }

  override solve(): void {
    if (!this.canSolveInBindings() || this.step !== BaseSolver.prototype.step || this._step !== TraceSimplificationSolverAdapter.prototype._step || this.tryFinalAcceptance !== BaseSolver.prototype.tryFinalAcceptance || "computeProgress" in this) {
      super.solve()
      return
    }
    const start = Date.now()
    this.push()
    try { withQueryGraph(this.graph, () => this.binding.solve()) }
    finally { this.syncBase(); if (this.observed) this.sync(); else { if (this.statsObserved) this.hydrateSolver(this.binding.statistics(), this.stateValues); if (Object.keys(this.outputValues).length) this.readOutput(false) } }
    this.timeToSolve = Date.now() - start
  }

  dispose(): void { this.binding.free() }
}

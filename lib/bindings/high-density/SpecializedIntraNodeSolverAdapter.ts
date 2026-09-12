import type { GraphicsObject } from "graphics-debug"
import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { BaseSolver } from "../../solvers/BaseSolver"
import { safeTransparentize } from "../../solvers/colors"
import { getSpecializedRouterContext } from "lib/bindings/high-density/specializedRouterContext"
import { CandidateIdentityMap } from "lib/bindings/high-density/CandidateIdentityMap"

type DiagnosticRecord = Record<string, unknown>
type SpecializedConstructor = typeof SpecializedIntraNodeSolverAdapter & { solverKind: string; diagnosticFields: string[] }

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown): unknown => entry instanceof Map ? Object.fromEntries(entry) : entry)
}

function reconcile(current: unknown, incoming: unknown, key = ""): unknown {
  if (current instanceof Map || key === "completedPaths" || key === "placeholderPaths" || key === "portPairMap") {
    const map = current instanceof Map ? current : new Map<string, unknown>()
    const record = incoming as DiagnosticRecord
    for (const name of map.keys()) if (!Object.hasOwn(record, name)) map.delete(name)
    for (const [name, value] of Object.entries(record)) map.set(name, reconcile(map.get(name), value))
    return map
  }
  if (Array.isArray(incoming)) {
    const array: unknown[] = Array.isArray(current) ? current : []
    incoming.forEach((value, index): void => { array[index] = reconcile(array[index], value, key === "forces" ? "forceRows" : key === "forceRows" ? "forceMap" : "") })
    array.length = incoming.length
    return array
  }
  if (incoming && typeof incoming === "object") {
    if (key === "forceMap") return reconcile(current instanceof Map ? current : new Map(), incoming)
    const record = current && typeof current === "object" && !Array.isArray(current) ? current as DiagnosticRecord : {}
    for (const name of Object.keys(record)) if (!Object.hasOwn(incoming, name)) delete record[name]
    for (const [name, value] of Object.entries(incoming)) record[name] = reconcile(record[name], value, name)
    return record
  }
  return incoming
}

export class SpecializedIntraNodeSolverAdapter extends BaseSolver {
  static solverKind = ""
  static diagnosticFields: string[] = []
  protected readonly binding: bindings.SpecializedIntraNodeDispatcher
  private readonly observed = new Map<string, unknown>()
  private readonly candidateIdentity: CandidateIdentityMap | undefined
  private readonly initialProps: DiagnosticRecord
  private diagnosticObserver?: () => void
  private observedRoutes?: unknown[]
  private routesBytes?: string
  private readonly sourceAliases = new Map<string, { value: unknown }>()

  constructor(props: object) {
    super()
    initializeAutorouterBindings()
    this.initialProps = props as DiagnosticRecord
    const ctor = this.constructor as SpecializedConstructor
    this.candidateIdentity = ctor.solverKind.startsWith("multi-head") ? new CandidateIdentityMap() : undefined
    const shared = getSpecializedRouterContext(ctor.solverKind, this.initialProps)
    this.binding = shared ? shared.context.create(ctor.solverKind, shared.params)
      : new bindings.SpecializedIntraNodeDispatcher(ctor.solverKind, props)
    this.syncState()
    for (const field of ["nodeWithPortPoints", "colorMap", "hyperParameters", "connMap"]) {
      const value = this.initialProps[field]
      if (value !== undefined && ctor.diagnosticFields.includes(field)) this.sourceAliases.set(field, { value })
    }
    const node = this.initialProps.nodeWithPortPoints as DiagnosticRecord | undefined
    if (node?.availableZ && ctor.diagnosticFields.includes("availableZ")) this.sourceAliases.set("availableZ", { value: node.availableZ })
    for (const field of ctor.diagnosticFields) {
      if (["progress", "iterations", "solved", "failed", "error", "MAX_ITERATIONS"].includes(field)) continue
      if (field === "solvedRoutes") {
        Object.defineProperty(this, field, {
          configurable: true, enumerable: true,
          get: (): unknown[] => {
            if (!this.observedRoutes) {
              this.diagnosticObserver?.()
              this.observedRoutes = this.binding.solvedRoutes()
              this.routesBytes = encode(this.observedRoutes)
            }
            this.restoreSourceMetadata(this.observedRoutes, "solvedRoutes")
            return this.observedRoutes
          },
          set: (routes: unknown[]): void => { this.diagnosticObserver?.(); this.observedRoutes = routes; this.routesBytes = undefined },
        })
        continue
      }
      Object.defineProperty(this, field, {
        configurable: true, enumerable: true,
        get: (): unknown => {
          if (!this.observed.has(field)) {
            this.diagnosticObserver?.()
            const alias = this.sourceAliases.get(field)
            const snapshot = alias ? undefined : this.readSnapshot(true)
            this.observed.set(field, alias ? alias.value : this.candidateIdentity && (field === "candidates" || field === "lastCandidate") ? snapshot![field] : reconcile(undefined, snapshot![field], field))
          }
          this.restoreViaAliases(field)
          const value = this.observed.get(field)
          this.restoreSourceMetadata(value, field)
          return value
        },
        set: (value: unknown): void => { this.diagnosticObserver?.(); this.observed.set(field, value) },
      })
    }
  }

  protected syncState(): void {
    const state = this.binding.state()
    this.MAX_ITERATIONS = state.MAX_ITERATIONS
    this.solved = state.solved
    this.failed = state.failed
    this.iterations = state.iterations
    this.progress = state.progress ?? Number.NaN
    this.error = state.error
  }

  setDiagnosticObserver(observer: () => void): void { this.diagnosticObserver = observer }

  pushObservedDiagnostics(): void {
    this.binding.restoreState({ MAX_ITERATIONS: this.MAX_ITERATIONS, solved: this.solved,
      failed: this.failed, iterations: this.iterations, progress: this.progress, error: this.error })
    const routesChanged = this.observedRoutes !== undefined && encode(this.observedRoutes) !== this.routesBytes
    if (this.observed.size === 0 && !routesChanged) return
    const snapshot = this.readSnapshot(true)
    Object.assign(snapshot, { MAX_ITERATIONS: this.MAX_ITERATIONS, solved: this.solved, failed: this.failed,
      iterations: this.iterations, progress: this.progress, error: this.error })
    for (const [field, value] of this.observed) snapshot[field] = value
    if (routesChanged) snapshot.solvedRoutes = this.observedRoutes
    if (this.candidateIdentity) this.binding.restoreIdentity(snapshot, this.candidateIdentity.snapshot(snapshot))
    else this.binding.restore(snapshot)
    if (this.observedRoutes) this.routesBytes = encode(this.observedRoutes)
  }

  syncObservedDiagnostics(): void {
    this.syncState()
    if (this.observedRoutes) {
      reconcile(this.observedRoutes, this.binding.solvedRoutes())
      this.routesBytes = encode(this.observedRoutes)
    }
    if (this.observed.size === 0) return
    const snapshot = this.readSnapshot(false)
    const via = (this.constructor as SpecializedConstructor).solverKind === "via-possibilities2"
    const changedConnection = via && this.observed.has("currentConnectionName") && snapshot.currentConnectionName !== this.observed.get("currentConnectionName")
    for (const [field, value] of this.observed) {
      if (via && field === "currentHead") continue
      if (changedConnection && field === "currentPath") {
        this.observed.set(field, reconcile(undefined, snapshot[field], field))
        continue
      }
      if (this.sourceAliases.get(field)?.value === value) continue
      this.observed.set(field, this.candidateIdentity && (field === "candidates" || field === "lastCandidate") ? snapshot[field] : reconcile(value, snapshot[field], field))
      this.restoreSourceMetadata(this.observed.get(field), field)
    }
    this.restoreViaAliases()
  }

  dispose(): void { this.binding.free() }

  shareForPortfolio(): number { this.pushObservedDiagnostics(); return this.binding.shareForPortfolio() }

  private restoreViaAliases(field?: string): void {
    if ((this.constructor as SpecializedConstructor).solverKind !== "via-possibilities2") return
    const fields = ["portPairMap", "completedPaths", "currentPath", "currentHead", "currentConnectionName"]
    if (field !== undefined && !fields.includes(field)) return
    if (!fields.some(name => this.observed.has(name))) return
    const missing = fields.filter(name => !this.observed.has(name))
    if (missing.length) {
      const snapshot = this.binding.snapshot()
      for (const name of missing) this.observed.set(name, reconcile(undefined, snapshot[name], name))
    }
    const ports = (this.initialProps.nodeWithPortPoints as { portPoints: DiagnosticRecord[] }).portPoints
    const pairs = this.observed.get("portPairMap") as Map<string, { start: DiagnosticRecord; end: DiagnosticRecord }>
    for (const [name, pair] of pairs) {
      const matching = ports.filter(port => port.connectionName === name)
      if (matching.length) { pair.start = matching[0]!; if (matching.length > 1) pair.end = matching[matching.length - 1]! }
    }
    const completed = this.observed.get("completedPaths") as Map<string, DiagnosticRecord[]>
    for (const [name, path] of completed) {
      const pair = pairs.get(name)!
      if (path.length) { path[0] = pair.start; path[path.length - 1] = pair.end }
    }
    const path = this.observed.get("currentPath") as DiagnosticRecord[]
    const name = this.observed.get("currentConnectionName") as string
    const pair = pairs.get(name)
    if (pair && path.length) path[0] = pair.start
    if (this.solved && completed.has(name)) {
      completed.set(name, path)
      path[path.length - 1] = pair!.end
    }
    const headIndex = this.solved ? path.length - 2 : path.length - 1
    if (headIndex >= 0) this.observed.set("currentHead", path[headIndex])
  }

  private restoreSourceMetadata(value: unknown, field: string): void {
    const node = this.initialProps.nodeWithPortPoints as { portPoints?: DiagnosticRecord[] } | undefined
    const ports = node?.portPoints ?? []
    const kind = (this.constructor as SpecializedConstructor).solverKind
    if (field === "obstacles" && Array.isArray(value) && Array.isArray(this.initialProps.obstacles)) {
      value.forEach((obstacle: DiagnosticRecord, index): void => {
        const source = (this.initialProps.obstacles as DiagnosticRecord[])[index]
        if (!source) return
        for (const [key, nested] of Object.entries(source)) if (key !== "__zLayers" && nested !== null && typeof nested === "object") obstacle[key] = nested
      })
    }
    const visit = (entry: unknown): void => {
      if (!entry || typeof entry !== "object") return
      if (entry instanceof Map) { for (const item of entry.values()) visit(item); return }
      if (Array.isArray(entry)) { for (const item of entry) visit(item); return }
      const record = entry as DiagnosticRecord
      if (record.portPointId !== undefined) {
        const source = ports.find(port => port.portPointId === record.portPointId)
        if (source) for (const [key, nested] of Object.entries(source)) if (nested !== null && typeof nested === "object") record[key] = nested
      }
      if (kind === "through-obstacle" && "connectionName" in record && ("A" in record || "route" in record) && !Object.hasOwn(record, "rootConnectionName")) record.rootConnectionName = undefined
      for (const [key, nested] of Object.entries(record)) {
        if (key !== "linkedPortPoints") visit(nested)
      }
    }
    visit(value)
  }

  private readSnapshot(preserveExisting: boolean): DiagnosticRecord {
    const snapshot = this.binding.snapshot()
    if (!this.candidateIdentity) return snapshot
    const identity = this.binding.snapshotIdentity()
    for (const field of ["candidates", "lastCandidate"]) snapshot[field] = this.candidateIdentity.restore(this.observed.get(field), snapshot[field], identity.fields![field], reconcile, preserveExisting)
    return snapshot
  }

  private observeSourceAliases(): void {
    for (const [field, alias] of this.sourceAliases) {
      if (!this.observed.has(field)) {
        this.diagnosticObserver?.()
        this.observed.set(field, alias.value)
      }
    }
  }

  protected invoke<T>(method: string, args: unknown[] = []): T {
    this.observeSourceAliases()
    this.pushObservedDiagnostics()
    const output = this.candidateIdentity
      ? this.binding.invokeIdentity(method, args, this.candidateIdentity.arguments(method, args))
      : this.binding.invoke(method, args)
    for (let i = 0; i < args.length; i++) reconcile(args[i], output.args[i])
    const result = this.candidateIdentity
      ? this.candidateIdentity.restore(undefined, output.result, output.identity?.result, reconcile) as T
      : reconcile(undefined, output.result) as T
    this.syncObservedDiagnostics()
    return result
  }

  override solve(): void {
    const started = Date.now()
    this.observeSourceAliases()
    this.pushObservedDiagnostics()
    try { this.binding.solve() } finally { this.syncObservedDiagnostics() }
    this.timeToSolve = Date.now() - started
  }

  override _step(): void {
    this.observeSourceAliases()
    this.pushObservedDiagnostics()
    this.binding.stepInner(this.iterations, this.MAX_ITERATIONS)
    this.syncObservedDiagnostics()
  }

  override tryFinalAcceptance(): void {
    this.pushObservedDiagnostics()
    this.binding.tryFinalAcceptance()
    this.syncObservedDiagnostics()
  }

  computeProgress(): number { return this.binding.computeProgress() }

  override visualize(): GraphicsObject {
    this.observeSourceAliases()
    this.pushObservedDiagnostics()
    return this.binding.visualize(safeTransparentize)
  }

  protected static applicable(kind: string, props: unknown): boolean {
    initializeAutorouterBindings()
    return bindings.SpecializedIntraNodeDispatcher.isApplicable(kind, props)
  }
}

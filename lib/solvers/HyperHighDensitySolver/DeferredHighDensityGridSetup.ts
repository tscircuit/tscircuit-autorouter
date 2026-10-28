import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { EndpointPreservingHighDensitySolverA01 } from "./EndpointPreservingHighDensitySolverA01"

type GridSolver = HighDensitySolverA01 | HighDensitySolverA03
const a01Setup = HighDensitySolverA01.prototype.setup
const a01SetupBody = HighDensitySolverA01.prototype._setup
const a03Setup = HighDensitySolverA03.prototype.setup
const a03SetupBody = HighDensitySolverA03.prototype._setup
const inspectionNames = ["solvedConnectionsMap", "unsolvedConnections", "gridStats", "activeConnection", "openSet"] as const
type InspectionName = (typeof inspectionNames)[number]
type InspectionGetter = (this: GridSolver) => unknown
const a01InspectionGetters = new Map<InspectionName, InspectionGetter | undefined>(inspectionNames.map((name) =>
  [name, Object.getOwnPropertyDescriptor(HighDensitySolverA01.prototype, name)?.get] as const))
const a03InspectionGetters = new Map<InspectionName, InspectionGetter | undefined>(inspectionNames.map((name) =>
  [name, Object.getOwnPropertyDescriptor(HighDensitySolverA03.prototype, name)?.get] as const))
const deferredBySolver = new WeakMap<GridSolver, DeferredHighDensityGridSetup>()
const deferredPrototypeByOriginal = new WeakMap<object, object>()

const getDeferredSetup = (solver: GridSolver): DeferredHighDensityGridSetup => {
  const deferred = deferredBySolver.get(solver)
  if (!deferred) {
    throw new Error("Deferred grid prototype is missing its setup certificate")
  }
  return deferred
}

/** Shared cold wrappers never add or delete properties on a search instance. */
const getDeferredPrototype = (original: object, getters: Map<InspectionName, InspectionGetter | undefined>): object => {
  const existing = deferredPrototypeByOriginal.get(original)
  if (existing) return existing
  const prototype: object = Object.create(original)
  Object.defineProperties(prototype, {
    setup: { value: function setup(this: GridSolver): void {
      getDeferredSetup(this).materialize()
    } },
    getOutput: { value: function getOutput(this: GridSolver): ReturnType<GridSolver["getOutput"]> {
      return getDeferredSetup(this).getOutput()
    } },
  })
  for (const name of inspectionNames) {
    const getter = getters.get(name)
    if (!getter) throw new Error(`Pinned grid inspection getter is missing: ${name}`)
    Object.defineProperty(prototype, name, { get: function inspect(this: GridSolver): unknown {
      getDeferredSetup(this).materialize()
      return getter.call(this)
    } })
  }
  Object.freeze(prototype)
  deferredPrototypeByOriginal.set(original, prototype)
  return prototype
}

/**
 * Defers only allocation, with an exact advertised post-setup iteration cap.
 * This is tied to the pinned A01/A03 budget formula and portfolio grid recipe.
 */
export class DeferredHighDensityGridSetup {
  pending = true
  private readonly setupRequest: number
  private readonly originalSetup: GridSolver["setup"]
  private readonly originalGetOutput: GridSolver["getOutput"]
  private readonly originalPrototype: object
  private readonly deferredPrototype: object
  private onMaterialized: (() => void) | undefined

  static isEligible(solver: GridSolver, iterationCap: number): boolean {
    // Own methods would shadow the shared pending prototype. Descriptor reads
    // also avoid invoking custom accessors during certification.
    for (const name of ["setup", "getOutput"] as const) {
      if (Object.hasOwn(solver, name)) return false
      let owner: object | null = solver
      while (owner) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, name)
        if (descriptor) {
          if (!("value" in descriptor) || descriptor.writable !== true) return false
          break
        }
        owner = Object.getPrototypeOf(owner)
      }
      if (!owner) return false
    }
    if (Object.hasOwn(solver, "constructor")) return false
    const isA01 = solver instanceof HighDensitySolverA01
    if (isA01
      ? (solver.constructor !== HighDensitySolverA01 && solver.constructor !== EndpointPreservingHighDensitySolverA01) ||
          solver.setup !== a01Setup || solver._setup !== a01SetupBody
      : solver.constructor !== HighDensitySolverA03 || solver.setup !== a03Setup || solver._setup !== a03SetupBody
    ) return false
    const prototype = isA01 ? HighDensitySolverA01.prototype : HighDensitySolverA03.prototype
    const getters = isA01 ? a01InspectionGetters : a03InspectionGetters
    if (!Object.isExtensible(solver) || inspectionNames.some((name) =>
      Object.hasOwn(solver, name) || typeof getters.get(name) !== "function" ||
      Object.getOwnPropertyDescriptor(prototype, name)?.get !== getters.get(name))) return false
    const requested = Math.max(1, solver.MAX_ITERATIONS)
    const naturalMinimum = Math.min(
      requested,
      Math.max(150_000, Math.min(2_000_000, Math.round(requested * 0.2))),
    )
    if (
      !Number.isSafeInteger(requested) ||
      !Number.isSafeInteger(iterationCap) || iterationCap < 1 ||
      iterationCap > naturalMinimum || solver._setupDone ||
      solver.iterations !== 0 || solver.solved || solver.failed ||
      solver.maxCellCount !== undefined || solver.initialPenaltyFn !== undefined
    ) return false

    const node = solver.nodeWithPortPoints
    const layers = node.availableZ ?? [...new Set(node.portPoints.map((point) => point.z))]
    if (
      !Number.isFinite(node.width) || !Number.isFinite(node.height) ||
      !Number.isFinite(node.center.x) || !Number.isFinite(node.center.y) ||
      node.width < 0.1 || node.height < 0.1 || !Array.isArray(layers) || layers.length === 0 ||
      new Set(layers).size !== layers.length ||
      layers.some((layer) => !Number.isSafeInteger(layer) || layer < 0) ||
      node.portPoints.some((point) =>
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isSafeInteger(point.z) || !layers.includes(point.z) ||
        typeof point.connectionName !== "string" ||
        (point.rootConnectionName !== undefined && typeof point.rootConnectionName !== "string")) ||
      !Number.isFinite(solver.effort) || solver.effort <= 0 ||
      !Number.isFinite(solver.viaDiameter) || solver.viaDiameter <= 0 ||
      !Number.isFinite(solver.traceThickness) || solver.traceThickness <= 0 ||
      !Number.isFinite(solver.traceMargin) || solver.traceMargin < 0 ||
      solver.viaMinDistFromBorder !== solver.viaDiameter / 2
    ) return false

    const states = Math.ceil(node.width / 0.1) * Math.ceil(node.height / 0.1) * layers.length
    if (!Number.isSafeInteger(states) || states > 0x7fffffff) return false
    return isA01
      ? solver.cellSizeMm === 0.1
      : solver.highResolutionCellSize === 0.1 &&
          solver.lowResolutionCellSize === 0.4 &&
          solver.highResolutionCellThickness === 8
  }

  static createIfEligible(
    solver: GridSolver,
    iterationCap: number,
    onMaterialized: () => void,
  ): DeferredHighDensityGridSetup | undefined {
    if (!DeferredHighDensityGridSetup.isEligible(solver, iterationCap)) return undefined
    return new DeferredHighDensityGridSetup(solver, iterationCap, onMaterialized)
  }

  private constructor(
    readonly solver: GridSolver,
    readonly iterationCap: number,
    onMaterialized: () => void,
  ) {
    this.setupRequest = solver.MAX_ITERATIONS
    this.originalSetup = solver.setup
    this.originalGetOutput = solver.getOutput
    this.originalPrototype = Object.getPrototypeOf(solver) as object
    const getters = solver instanceof HighDensitySolverA01 ? a01InspectionGetters : a03InspectionGetters
    this.deferredPrototype = getDeferredPrototype(this.originalPrototype, getters)
    this.onMaterialized = onMaterialized
    deferredBySolver.set(solver, this)
    solver.MAX_ITERATIONS = iterationCap
    Object.setPrototypeOf(solver, this.deferredPrototype)
  }

  getOutput(): ReturnType<GridSolver["getOutput"]> {
    // A caller may retain the shared pending method before setup. Its state
    // remains valid after materialization without keeping the portfolio alive.
    this.materialize()
    return this.originalGetOutput.call(this.solver)
  }

  materialize(): void {
    if (!this.pending) {
      this.originalSetup.call(this.solver)
      return
    }
    if (this.solver.MAX_ITERATIONS !== this.iterationCap) {
      throw new Error("Deferred grid iteration allocation changed before setup")
    }
    if (Object.getPrototypeOf(this.solver) !== this.deferredPrototype ||
      Object.hasOwn(this.solver, "setup") || Object.hasOwn(this.solver, "getOutput") ||
      inspectionNames.some((name) => Object.hasOwn(this.solver, name))) {
      throw new Error("Deferred grid inspection contract changed before setup")
    }
    // Restore the native prototype before allocation or search. Installing and
    // deleting own accessors here would change every hot search object's shape.
    Object.setPrototypeOf(this.solver, this.originalPrototype)
    // The kernel's natural budget depends on its constructor MAX request.
    // Passing the advertised small cap into setup would reduce it a second time.
    this.solver.MAX_ITERATIONS = this.setupRequest
    this.originalSetup.call(this.solver)
    const actualCap = Math.min(this.solver.MAX_ITERATIONS, this.iterationCap)
    if (
      actualCap !== this.iterationCap || !this.solver._setupDone ||
      this.solver.iterations !== 0 || this.solver.solved || this.solver.failed ||
      this.solver.progress !== 0
    ) {
      throw new Error("Pinned grid setup violated its deferred budget/state certificate")
    }
    this.solver.MAX_ITERATIONS = actualCap
    if (!this.onMaterialized) throw new Error("Deferred grid materialization callback is missing")
    const onMaterialized = this.onMaterialized
    this.pending = false
    this.onMaterialized = undefined
    onMaterialized()
  }
}

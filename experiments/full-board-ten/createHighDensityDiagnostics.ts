import assert from "node:assert/strict"
import { getHighDensityPortContext } from "./getHighDensityPortContext"

type RuntimeObject = Record<string, any>
type DiagnosticOptions = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  targetNodeId: string
  targetPhase: string
  onSnapshot: (report: RuntimeObject, event: string) => void
}

const solverSummary = (solver: RuntimeObject): RuntimeObject => ({
  name: solver.getSolverName(),
  iterations: solver.iterations,
  maxIterations: solver.MAX_ITERATIONS,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  stats: structuredClone(solver.stats),
})

/** Observe owned published instances without changing inputs or stepping children. */
export function createHighDensityDiagnostics(options: DiagnosticOptions): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass)
  let report: RuntimeObject | null = null
  let pipeline: RuntimeObject | undefined
  let highDensity: RuntimeObject | undefined
  const b01Attempts = new WeakMap<object, RuntimeObject>()
  const regionalAttempts = new WeakMap<object, RuntimeObject>()
  const restorations: (() => void)[] = []
  const restoreMethod = (
    object: RuntimeObject,
    descriptor: PropertyDescriptor | undefined,
  ): void => {
    if (descriptor) Object.defineProperty(object, "step", descriptor)
    else delete object.step
  }

  const observeB01 = (solver: RuntimeObject | null): void => {
    if (!solver || solver.nodeWithPortPoints.capacityMeshNodeId !== options.targetNodeId) return
    assert(report)
    let attempt = b01Attempts.get(solver)
    if (!attempt) {
      const constructorParams = solver.getConstructorParams()
      assert.equal(constructorParams.length, 1)
      assert.equal(constructorParams[0].initialPenaltyFn, undefined, "Cannot serialize an unexpected B01 penalty callback")
      attempt = {
        constructorParams: structuredClone(constructorParams[0]),
        initial: { ...solverSummary(solver), maxRips: solver.MAX_RIPS },
      }
      b01Attempts.set(solver, attempt)
      report.b01Attempts.push(attempt)
      if (options.targetNodeId === "topology_merge_7204" && report.nativeContexts.length === 0) {
        assert(pipeline)
        for (const context of getHighDensityPortContext(pipeline)) {
          report.nativeContexts.push(context)
          options.onSnapshot(report, "native-context")
        }
      }
      options.onSnapshot(report, "b01-input")
    }
    if ((solver.failed || solver.solved) && !attempt.final) {
      attempt.final = { ...solverSummary(solver), maxRips: solver.MAX_RIPS }
      options.onSnapshot(report, "b01-outcome")
    }
  }

  const observeRegional = (solver: RuntimeObject | null): void => {
    if (!solver || solver.params.nodeWithPortPoints.capacityMeshNodeId !== options.targetNodeId) return
    assert(report && highDensity)
    let attempt = regionalAttempts.get(solver)
    if (!attempt) {
      const { connMap, movablePreloadedConnectionNames, ...params } = solver.params
      assert(movablePreloadedConnectionNames instanceof Set)
      const constructorParams = structuredClone(params)
      if (constructorParams.nodePfById instanceof Map) {
        constructorParams.nodePfById = Object.fromEntries(constructorParams.nodePfById)
      }
      attempt = {
        constructorParams,
        connectivityNetMap: structuredClone(connMap.netMap),
        movablePreloadedConnectionNames: [...movablePreloadedConnectionNames],
        originalNode: structuredClone(highDensity.activeNode),
        primaryFailure: highDensity.activeFallbackReason,
        fixedRouteSections: structuredClone([...highDensity.activeFallbackFixedRouteSections]),
        fixedObstacleRoutes: structuredClone(highDensity.activeFallbackFixedObstacleRoutes),
        promotedFixedRouteConnectionNames: [...highDensity.activeFallbackPromotedFixedRouteConnectionNames],
        initial: solverSummary(solver),
      }
      regionalAttempts.set(solver, attempt)
      report.regionalAttempts.push(attempt)
      options.onSnapshot(report, "regional-input")
    }
    if ((solver.failed || solver.solved) && !attempt.final) {
      const regular = solver.highDensitySolver
      const nodeSolvers = [...regular.failedSolvers]
      if (regular.activeSubSolver) nodeSolvers.push(regular.activeSubSolver)
      attempt.final = {
        ...solverSummary(solver),
        highDensity: solverSummary(regular),
        nodeSolveMetadata: structuredClone([...regular.nodeSolveMetadataById]),
        nodeSolvers: nodeSolvers.map((nodeSolver: RuntimeObject): RuntimeObject => {
          const {
            connMap: _, colorMap: __, obstacles: ___,
            growShrinkSolutionValidator, ...params
          } = nodeSolver.getConstructorParams()
          const portfolios = [...nodeSolver.failedSolvers]
          if (nodeSolver.activeSubSolver) portfolios.push(nodeSolver.activeSubSolver)
          const constructorParams = structuredClone(params)
          if (constructorParams.nodePfById instanceof Map) {
            constructorParams.nodePfById = Object.fromEntries(constructorParams.nodePfById)
          }
          return {
            ...solverSummary(nodeSolver),
            constructorParams,
            hasCleanupValidator: typeof growShrinkSolutionValidator === "function",
            scaleFactor: nodeSolver.scaleFactor,
            growthAttempts: nodeSolver.growthAttempts,
            maxGrowthAttempts: nodeSolver.maxGrowthAttempts,
            minimumGrowthAttempts: nodeSolver.minimumGrowthAttempts,
            attempts: portfolios.map((portfolio: RuntimeObject): RuntimeObject => ({
              ...solverSummary(portfolio),
              node: structuredClone(portfolio.nodeWithPortPoints),
              candidates: (portfolio.supervisedSolvers ?? []).map((candidate: RuntimeObject): RuntimeObject => ({
                ...solverSummary(candidate.solver),
                hyperParameters: structuredClone(candidate.hyperParameters),
                fitness: { g: candidate.g, h: candidate.h, f: candidate.f },
              })),
            })),
          }
        }),
      }
      options.onSnapshot(report, "regional-outcome")
    }
  }

  const installHighDensity = (solver: RuntimeObject): void => {
    assert.equal(highDensity, undefined)
    highDensity = solver
    assert(report)
    report.highDensityInitial = solverSummary(solver)
    const descriptor = Object.getOwnPropertyDescriptor(solver, "step")
    const original = solver.step
    assert.equal(typeof original, "function")
    solver.step = function (this: RuntimeObject, ...args: unknown[]): unknown {
      // The parent clears these references when a child fails. Retain ownership
      // through the original call so failure packets describe the actual child.
      const b01 = this.activeB01Solver
      const regional = this.activeFallbackSolver
      observeB01(b01)
      observeRegional(regional)
      const result = Reflect.apply(original, this, args)
      observeB01(b01)
      observeRegional(regional)
      observeB01(this.activeB01Solver)
      observeRegional(this.activeFallbackSolver)
      return result
    }
    restorations.push(() => restoreMethod(solver, descriptor))
    observeB01(solver.activeB01Solver)
    observeRegional(solver.activeFallbackSolver)
  }

  return {
    onSolverStarted(event: RuntimeObject, phase: string | undefined): void {
      assert.equal(report, null)
      assert.equal(phase, options.targetPhase)
      const input = event.solverParams?.input
      assert(input && Array.isArray(input.connections))
      report = {
        instrumentation: "published-instance HD lifecycle observer; no input, options or routing source changes",
        targetNodeId: options.targetNodeId,
        phase,
        inputNetCount: input.connections.length,
        b01Attempts: [],
        regionalAttempts: [],
        nativeContexts: [],
      }
      const prototype = options.pipelineClass.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "step")
      const original = prototype.step
      assert.equal(typeof original, "function")
      prototype.step = function (this: RuntimeObject, ...args: unknown[]): unknown {
        if (!pipeline) {
          assert.equal(this.originalSrj.connections, input.connections)
          assert.equal(this.originalSrj.traces, input.traces)
          pipeline = this
        }
        assert.equal(this, pipeline)
        const result = Reflect.apply(original, this, args)
        if (this.highDensityRouteSolver && !highDensity) {
          installHighDensity(this.highDensityRouteSolver)
          restoreMethod(prototype, descriptor)
        }
        return result
      }
      restorations.push(() => restoreMethod(prototype, descriptor))
    },
    finish(): RuntimeObject | null {
      if (report) {
        report.highDensityHookInstalled = Boolean(highDensity)
        report.targetObserved = report.b01Attempts.length > 0 || report.regionalAttempts.length > 0
        if (highDensity) report.highDensityFinal = solverSummary(highDensity)
        options.onSnapshot(report, "finished")
      }
      for (const restore of restorations.reverse()) restore()
      return report
    },
  }
}

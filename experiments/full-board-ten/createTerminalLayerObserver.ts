import assert from "node:assert/strict"

type RuntimeObject = Record<string, any>
type Observation = Record<string, any>
const targetConnection = "source_net_0_mst8"
const rootConnection = "source_net_0"

/** Observe existing calls only; never obtain a second solver output. */
export function createTerminalLayerObserver(pipeline: RuntimeObject): {
  beforePipelineStep: () => RuntimeObject | null
  afterPipelineStep: (previousSingle: RuntimeObject | null) => void
  getReport: () => Observation
  dispose: () => void
} {
  const report: Observation = {
    targetConnection, rootConnection, diagnosticOnly: true,
    stages: {}, attempts: [], phaseTransitions: [],
    policy: "Existing factory called once; no additional getOutput, changed choices, budgets, input or cache.",
  }
  const restorations: Array<() => void> = []
  const attempts = new WeakMap<object, Observation>()
  let previousPhase: string | undefined
  const rootRoutes = (routes: RuntimeObject[]): RuntimeObject[] => {
    assert(Array.isArray(routes), "Expected existing HD route array")
    return structuredClone(routes.filter(route =>
      route.connectionName === rootConnection ||
      route.connectionName.startsWith(`${rootConnection}_mst`) ||
      route.rootConnectionName === rootConnection,
    ))
  }
  for (const phaseName of ["highDensityForceImproveSolver", "highDensityRepairSolver", "highDensityStitchSolver"]) {
    const definition = pipeline.pipelineDef.find((entry: RuntimeObject) => entry.solverName === phaseName)
    assert(definition, `Missing published stage ${phaseName}`)
    const original = definition.getConstructorParams
    definition.getConstructorParams = function (this: RuntimeObject, ...args: unknown[]): unknown {
      // Factory may call a stateful getOutput; invoke it exactly once.
      const parameters = Reflect.apply(original, this, args)
      const options = parameters[0]
      assert(!report.stages[phaseName], `Stage factory repeated: ${phaseName}`)
      const snapshot: Observation = {
        routeCount: options.hdRoutes.length,
        rootRoutes: rootRoutes(options.hdRoutes),
      }
      if (phaseName === "highDensityForceImproveSolver") {
        snapshot.rawRouteCount = pipeline.highDensityRouteSolver.routes.length
        snapshot.rawRootRoutes = rootRoutes(pipeline.highDensityRouteSolver.routes)
        snapshot.nodes = structuredClone(pipeline.highDensityNodePortPoints.filter((node: RuntimeObject) =>
          node.portPoints.some((point: RuntimeObject) => point.connectionName === targetConnection),
        ))
      }
      if (phaseName === "highDensityStitchSolver") {
        const { hdRoutes, otherHdRoutes, colorMap, connections, ...rest } = options
        snapshot.options = structuredClone(rest)
        snapshot.connections = structuredClone(connections.filter((connection: RuntimeObject) =>
          connection.name === rootConnection || connection.name.startsWith(`${rootConnection}_mst`),
        ))
        snapshot.otherRouteCount = otherHdRoutes.length
        snapshot.otherRootRoutes = rootRoutes(otherHdRoutes)
        snapshot.rootColor = colorMap[rootConnection]
        assert(snapshot.connections.some((connection: RuntimeObject) => connection.name === targetConnection), "Native plan omitted target pair")
      }
      report.stages[phaseName] = snapshot
      return parameters
    }
    restorations.push((): void => { definition.getConstructorParams = original })
  }
  const registerSingle = (single: RuntimeObject | null): Observation | undefined => {
    if (!single || single.mergedHdRoute.connectionName !== targetConnection) return undefined
    let attempt = attempts.get(single)
    if (!attempt) {
      attempt = {
        start: structuredClone(single.start), end: structuredClone(single.end),
        initialMerged: structuredClone(single.mergedHdRoute),
        initialRemaining: structuredClone(single.remainingHdRoutes),
        allowedLayerTransitionPointKeys: single.allowedLayerTransitionPointKeys ? [...single.allowedLayerTransitionPointKeys] : null,
        stitchClearanceMode: single.stitchClearanceMode,
        steps: [], clearanceQueries: [],
      }
      report.attempts.push(attempt)
      attempts.set(single, attempt)
      const original = single.isStitchSegmentClear
      single.isStitchSegmentClear = function (this: RuntimeObject, ...args: unknown[]): unknown {
        const result = Reflect.apply(original, this, args)
        attempt!.clearanceQueries.push({ request: structuredClone(args[0]), result })
        return result
      }
      restorations.push((): void => { single.isStitchSegmentClear = original })
    }
    return attempt
  }
  const singleState = (single: RuntimeObject): Observation => {
    const route = single.mergedHdRoute.route
    return {
      iterations: single.iterations, solved: single.solved, failed: single.failed, error: single.error,
      remainingCount: single.remainingHdRoutes.length, mergedPointCount: route.length,
      first: structuredClone(route[0]), last: structuredClone(route.at(-1)),
      startPcbPortId: single.mergedHdRoute.startPcbPortId,
      endPcbPortId: single.mergedHdRoute.endPcbPortId,
    }
  }
  let pendingBefore: Observation | null = null
  let pendingRemaining: RuntimeObject[] | null = null
  return {
    beforePipelineStep(): RuntimeObject | null {
      const phase = pipeline.getCurrentPhase()
      if (phase !== previousPhase) {
        report.phaseTransitions.push({ phase, iterations: pipeline.iterations })
        previousPhase = phase
      }
      const multiple = pipeline.highDensityStitchSolver
      if (multiple && !report.initialTargetQueue) {
        report.initialTargetQueue = structuredClone(multiple.unsolvedRoutes.filter((route: RuntimeObject) => route.connectionName === targetConnection))
      }
      const single = multiple?.activeSolver ?? null
      const attempt = registerSingle(single)
      pendingBefore = attempt ? singleState(single) : null
      // Retain references only until the immediately following step. Capture
      // discarded fragments if no continuation empties the pending route set.
      pendingRemaining = attempt ? [...single.remainingHdRoutes] : null
      return single
    },
    afterPipelineStep(previousSingle: RuntimeObject | null): void {
      const currentSingle = pipeline.highDensityStitchSolver?.activeSolver ?? null
      registerSingle(currentSingle)
      const attempt = previousSingle ? attempts.get(previousSingle) : undefined
      if (attempt && pendingBefore) {
        const after = singleState(previousSingle!)
        attempt.steps.push({ before: pendingBefore, after })
        if (pendingRemaining!.length > 0 && after.remainingCount === 0 &&
            after.mergedPointCount === pendingBefore.mergedPointCount && !after.solved && !after.failed) {
          attempt.discardedAfterNoContinuation = structuredClone(pendingRemaining)
        }
        if (after.solved || after.failed) {
          attempt.finalMerged = structuredClone(previousSingle!.mergedHdRoute)
          attempt.finalRemaining = structuredClone(previousSingle!.remainingHdRoutes)
        }
      }
      pendingBefore = null
      pendingRemaining = null
      report.finalPhase = pipeline.getCurrentPhase()
      report.pipelineState = { solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, iterations: pipeline.iterations }
    },
    getReport(): Observation {
      return report
    },
    dispose(): void {
      for (const restore of restorations.reverse()) restore()
    },
  }
}

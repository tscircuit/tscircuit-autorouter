import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
type StageOptions = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  onSnapshot: (report: RuntimeObject) => void
}

export const h616RemainingInputSha256 =
  "23f7f1041272a21b549809819b747a45616991c077ccd5a654e80a56b399fb49"

export const h616GeometryStages = [
  "highDensityRouteSolver",
  "highDensityForceImproveSolver",
  "highDensityRepairSolver",
  "highDensityStitchSolver",
  "traceSimplificationSolver",
  "traceWidthSolver",
  "globalDrcForceImproveSolver",
  "pipeline9JointDrcRepairSolver",
  "effortCleanupSolver",
  "lengthMatchingPostProcessingSolver",
  "powerTraceExpansionSolver",
] as const

const geometryStages = new Set<string>(h616GeometryStages)
const digest = (object: unknown): string =>
  createHash("sha256").update(JSON.stringify(object)).digest("hex")

/** Copy ordinary stored records without invoking any property accessor. */
function copySnapshot(object: any, depth = 0): any {
  if (object === null || typeof object !== "object") return object
  assert(depth <= 16, "Snapshot nesting bound exceeded")
  assert(Array.isArray(object) || [Object.prototype, null].includes(Object.getPrototypeOf(object)), "Snapshot must contain plain records")
  const copy: RuntimeObject = Array.isArray(object) ? [] : {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
    if (!descriptor.enumerable) continue
    assert("value" in descriptor, `Snapshot accessor is forbidden: ${key}`)
    copy[key] = copySnapshot(descriptor.value, depth + 1)
  }
  return copy
}

function rootConnectionName(route: RuntimeObject): string | undefined {
  for (const name of [
    route.rootConnectionName,
    route.connectionName,
    route.connection_name,
  ]) {
    if (typeof name !== "string") continue
    const match = /^source_net_(67|68|69)(?:$|[_-])/.exec(name)
    if (match) return `source_net_${match[1]}`
  }
}

function copyTargetRoutes(routes: unknown): RuntimeObject[] | undefined {
  if (routes === undefined) return undefined
  assert(Array.isArray(routes), "Observed route collection must be an array")
  const selected = routes.filter((route) => rootConnectionName(route))
  assert(selected.length <= 500, "Target route fragment bound exceeded")
  const pointCount = selected.reduce((count, route) => count + route.route.length, 0)
  assert(pointCount <= 20_000, "Target route point bound exceeded")
  return selected.map((route) => ({
    root: rootConnectionName(route),
    connectionName: route.connectionName,
    rootConnectionName: route.rootConnectionName,
    connection_name: route.connection_name,
    pcb_trace_id: route.pcb_trace_id,
    traceThickness: route.traceThickness,
    viaDiameter: route.viaDiameter,
    viaHoleDiameter: route.viaHoleDiameter,
    route: copySnapshot(route.route),
    vias: copySnapshot(route.vias),
  }))
}

function scalarStats(solver: RuntimeObject): RuntimeObject {
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(solver.stats ?? {})).flatMap(([name, descriptor]) => {
    assert("value" in descriptor, `Statistics accessor is forbidden: ${name}`)
    const count = descriptor.value
    return count === null || ["number", "string", "boolean"].includes(typeof count)
      ? [[name, count]]
      : []
  }))
}

/** Reconstruct only the already-computed outputs; never invoke an output getter. */
function completedStageRoutes(stage: string, solver: RuntimeObject): unknown {
  switch (stage) {
    case "highDensityRouteSolver": return solver.routes
    case "highDensityForceImproveSolver":
      return solver.originalHdRoutes.map((route: RuntimeObject, index: number) =>
        solver.improvedRoutesByIndex.get(index) ?? route,
      )
    case "highDensityRepairSolver":
      return solver.originalHdRoutes.map((route: RuntimeObject, index: number) =>
        solver.repairedRoutesByIndex.get(index) ?? route,
      )
    case "highDensityStitchSolver": return solver.mergedHdRoutes
    case "traceSimplificationSolver": return solver.simplifiedHdRoutes
    case "traceWidthSolver": return solver.hdRoutesWithWidths
    case "globalDrcForceImproveSolver": return solver.outputHdRoutes
    case "pipeline9JointDrcRepairSolver":
      return solver.combinedOutput ?? solver.exactRepairSolver?.outputHdRoutes ?? solver.inputNewHdRoutes
    case "effortCleanupSolver": return solver.bestRoutes
    case "lengthMatchingPostProcessingSolver": return solver.outputHdRoutes
    case "powerTraceExpansionSolver":
      return solver.powerTraceExpanderSolver.lastConnectivitySafeTraces
    default: throw new Error(`Unexpected geometry stage ${stage}`)
  }
}

function completedJointChildRoutes(stage: string, solver: RuntimeObject): unknown {
  switch (stage) {
    case "clearanceProjectionSolver": return solver.state.output
    case "initialBoundedRegionalRepairSolver":
    case "regionalB01RepairSolver":
    case "boundedRegionalRepairSolver": return solver.result.routes
    case "exactRepairSolver":
    case "traceContactRepairSolver": return solver.outputHdRoutes
    default: throw new Error(`Unexpected joint repair child ${stage}`)
  }
}

/** Observe the published instance and three native nets without changing routing. */
export function createH616StageDiagnostics(options: StageOptions): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  onAutoroutingEnd: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass)
  let report: RuntimeObject | null = null
  let input: RuntimeObject | undefined
  let observedPipeline: RuntimeObject | undefined
  let restore: (() => void) | undefined
  const completedChildren = new WeakSet<object>()
  const labels = new Set<string>()

  const observe = (callback: () => void): void => {
    if (report?.observationError) return
    try { callback() } catch (error) {
      report!.observationError = error instanceof Error ? error.stack : String(error)
    }
  }
  const record = (label: string, solver: RuntimeObject, collections: RuntimeObject): void => {
    assert(report && observedPipeline)
    assert(!labels.has(label), `Duplicate stage boundary ${label}`)
    assert(report.snapshots.length < 32, "Stage snapshot bound exceeded")
    const routes = Object.fromEntries(Object.entries(collections).map(([name, collection]) =>
      [name, copyTargetRoutes(collection)],
    ))
    assert(Object.values(routes).some((collection) => collection !== undefined), "No stored routes at completed boundary")
    if (geometryStages.has(label) || label === "autorouting_end") {
      const roots = new Set(routes.output?.map((route) => route.root))
      assert(["source_net_67", "source_net_68", "source_net_69"].every((root) => roots.has(root)), "Completed geometry boundary omitted a target net")
    }
    const snapshot = {
      label,
      pipelineIteration: observedPipeline.iterations,
      solverIterations: solver.iterations,
      solved: solver.solved,
      failed: solver.failed,
      stats: scalarStats(solver),
      routes,
    }
    const snapshotBytes = JSON.stringify(snapshot).length
    assert(snapshotBytes <= 2_000_000, "Stage snapshot byte bound exceeded")
    report.snapshotBytes += snapshotBytes
    assert(report.snapshotBytes <= 8_000_000, "Total stage snapshot byte bound exceeded")
    labels.add(label)
    report.snapshots.push(snapshot)
  }

  return {
    onSolverStarted(event, phase): void {
      if (phase !== "remaining" || event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph") return
      assert.equal(report, null, "Only one H616 remaining solver may be observed")
      input = event.solverParams.input
      assert.equal(digest(input), h616RemainingInputSha256, "Fresh phase3 input binding failed")
      assert.equal(input.connections.length, 37)
      const pad = input.obstacles.find((obstacle: RuntimeObject) =>
        obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_475",
      )
      assert(pad && pad.shape === "circle" && pad.width === 0.35)
      report = {
        schemaVersion: 1,
        targetPhase: "remaining",
        inputSha256: digest(input),
        normalizedOriginalSrjSha256: null,
        binding: "published constructor identity and original input connections/traces array identity",
        pad: copySnapshot(pad),
        targetConnections: copySnapshot(input.connections.filter((connection: RuntimeObject) =>
          ["source_net_67", "source_net_68", "source_net_69"].includes(connection.name),
        )),
        snapshots: [],
        snapshotBytes: 0,
        stepCalls: 0,
        finished: false,
        observationError: null,
      }
      assert.equal(report.targetConnections.length, 3)
      const prototype = options.pipelineClass.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "_step")
      assert(descriptor && typeof descriptor.value === "function")
      const original = descriptor.value
      const wrapped = function (this: RuntimeObject, ...args: unknown[]): unknown {
        let beforeStage: string | undefined
        let beforeSolver: RuntimeObject | undefined
        let joint: RuntimeObject | undefined
        let jointChild: RuntimeObject | undefined
        let jointChildStage: string | undefined
        observe(() => {
          if (!observedPipeline) {
            assert.equal(this.originalSrj.connections, input!.connections)
            assert.equal(this.originalSrj.traces, input!.traces)
            observedPipeline = this
            report!.normalizedOriginalSrjSha256 = digest(this.originalSrj)
          }
          assert.equal(this, observedPipeline, "Another Pipeline9 instance entered the scoped hook")
          report!.stepCalls++
          beforeStage = this.pipelineDef[this.currentPipelineStepIndex]?.solverName
          beforeSolver = this.activeSubSolver
          if (beforeStage === "pipeline9JointDrcRepairSolver" && beforeSolver) {
            joint = beforeSolver
            jointChild = joint.activeSubSolver
            jointChildStage = joint.traceContactRepairSolver === jointChild && jointChild
              ? "traceContactRepairSolver"
              : joint.pipelineDef[joint.currentPipelineStepIndex]?.solverName
          }
        })

        // This is the only call to original routing code. Original exceptions propagate unchanged.
        const returned = original.apply(this, args)

        observe(() => {
          if (joint && jointChild && jointChildStage && jointChild.solved && !completedChildren.has(jointChild)) {
            completedChildren.add(jointChild)
            record(`joint.${jointChildStage}`, jointChild, {
              childOutput: completedJointChildRoutes(jointChildStage, jointChild),
              childRepairCandidate: jointChild.repairCandidate,
              adoptedInitialCandidate: joint.initialBoundedRepairCandidate,
              adoptedRegionalInput: joint.regionalB01Params?.routes,
              adoptedBoundedInput: joint.boundedRegionalParams?.routes,
              combinedOutput: joint.combinedOutput,
            })
          }
          if (beforeStage && beforeSolver?.solved && geometryStages.has(beforeStage) && !completedChildren.has(beforeSolver)) {
            completedChildren.add(beforeSolver)
            record(beforeStage, beforeSolver, { output: completedStageRoutes(beforeStage, beforeSolver) })
          }
        })
        return returned
      }
      Object.defineProperty(prototype, "_step", { ...descriptor, value: wrapped })
      restore = () => {
        if (prototype._step !== wrapped) {
          report!.observationError ??= "Pipeline prototype changed before observer restoration"
          return
        }
        Object.defineProperty(prototype, "_step", descriptor)
        report!.prototypeRestored = prototype._step === original
      }
    },
    onAutoroutingEnd(event, phase): void {
      if (!report || phase !== "remaining") return
      observe(() => record("autorouting_end", observedPipeline!, {
        output: event.simpleRouteJson.traces,
      }))
    },
    finish(): RuntimeObject | null {
      if (!report) return null
      restore?.()
      restore = undefined
      report.finished = true
      report.completedGeometryStages = h616GeometryStages.filter((stage) => labels.has(stage))
      const immutableReport = copySnapshot(report)
      observedPipeline = undefined
      input = undefined
      options.onSnapshot(immutableReport)
      return immutableReport
    },
  }
}

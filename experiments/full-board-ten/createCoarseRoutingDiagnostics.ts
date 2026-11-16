import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { serialize } from "node:v8"

type RuntimeObject = Record<string, any>
type DiagnosticOptions = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  targetPhase: string | undefined
  verifyInitialQueueOrder?: boolean
  onSnapshot: (report: RuntimeObject) => void
}

const requiredNumber = (value: unknown, label: string): number => {
  assert.equal(typeof value, "number", `Missing numeric diagnostic field ${label}`)
  const number = value as number
  assert(Number.isFinite(number), `Nonfinite diagnostic field ${label}`)
  assert(number >= 0, `Negative diagnostic field ${label}`)
  return number
}

/** Observe the actual published instance. No solver, options or inputs are replaced. */
export function createCoarseRoutingDiagnostics(options: DiagnosticOptions): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass, "Core and observer must resolve the same published Pipeline9 constructor")
  let report: RuntimeObject | null = null
  let inner: RuntimeObject | undefined
  let pathing: RuntimeObject | undefined
  let observedPipeline: RuntimeObject | undefined
  let finalSnapshot: (() => RuntimeObject) | undefined
  const restorations: (() => void)[] = []
  const restoreMethod = (object: RuntimeObject, name: string, descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor) {
      Object.defineProperty(object, name, descriptor)
      return
    }
    if (Object.hasOwn(object, name)) delete object[name]
  }
  const routeDetail = (solver: RuntimeObject, routeId: number | undefined): RuntimeObject | null => {
    if (routeId === undefined) return null
    const { problem, topology } = solver
    const metadata = problem.routeMetadata?.[routeId]
    const connection = metadata?.simpleRouteConnection
    const ports = [problem.routeStartPort[routeId], problem.routeEndPort[routeId]]
    return {
      routeId, netId: problem.routeNet[routeId], connectionId: metadata?.connectionId ?? null,
      connectionName: connection?.name ?? null, rootConnectionNames: connection?.__rootConnectionNames ?? null,
      portIds: ports,
      portPoints: ports.map(port => ({ x: topology.portX[port] ?? null, y: topology.portY[port] ?? null, z: topology.portZ[port] ?? null })),
      terminalCount: connection?.pointsToConnect?.length ?? null,
      terminals: connection?.pointsToConnect?.slice(0, 4).map((point: RuntimeObject) => ({
        pointId: point.pointId ?? null, pcbPortId: point.pcb_port_id ?? null,
        x: point.x, y: point.y, layers: point.layers ?? null,
      })) ?? null,
    }
  }
  const regionWitness = (solver: RuntimeObject, regionId: number, candidatePortId: number): RuntimeObject => {
    const { topology, problem, state } = solver
    const incident: number[] = topology.regionIncidentPorts[regionId]
    assert(Array.isArray(incident), "Missing rejected-goal region incidence")
    const requiredPorts = new Set<number>([candidatePortId, state.goalPortId])
    assert([...requiredPorts].every(port => incident.includes(port)), "Goal witness ports must belong to the recorded region")
    const selectedPorts = new Set(incident.slice(0, 64))
    for (const port of requiredPorts) {
      if (selectedPorts.has(port)) continue
      const removable = [...selectedPorts].reverse().find(candidate => !requiredPorts.has(candidate))
      assert(removable !== undefined)
      selectedPorts.delete(removable)
      selectedPorts.add(port)
    }
    const portIds = incident.filter(port => selectedPorts.has(port))
    const point = (portId: number): RuntimeObject => ({
      portId, serializedPortId: topology.portMetadata?.[portId]?.serializedPortId ?? null,
      x: topology.portX[portId], y: topology.portY[portId], z: topology.portZ[portId],
      nativeAngle: topology.incidentPortRegion[portId][0] === regionId ? topology.portAngleForRegion1[portId] : topology.portAngleForRegion2?.[portId] ?? null,
      assignmentNetId: state.portAssignment[portId],
      reservationNetId: solver.problemSetup.portEndpointReservationNetId[portId],
      incidentRegions: topology.incidentPortRegion[portId],
    })
    const segments: number[][] = state.regionSegments[regionId]
    const foreign = segments.filter(segment => problem.routeNet[segment[0]!] !== state.currentRouteNetId)
    const selected = [...foreign, ...segments.filter(segment => problem.routeNet[segment[0]!] === state.currentRouteNetId)].slice(0, 24)
    const metadata = topology.regionMetadata?.[regionId]
    return {
      regionId, serializedRegionId: metadata?.serializedRegionId ?? null,
      center: { x: topology.regionCenterX[regionId], y: topology.regionCenterY[regionId] },
      width: topology.regionWidth[regionId], height: topology.regionHeight[regionId],
      sourceBounds: metadata?.bounds ?? null, sourceCenter: metadata?.center ?? null,
      sourceWidth: metadata?.width ?? null, sourceHeight: metadata?.height ?? null,
      availableZMask: topology.regionAvailableZMask?.[regionId] ?? null,
      reservedNetId: problem.regionNetId[regionId],
      incidentPortCount: incident.length, ports: portIds.map(point),
      omittedPortCount: incident.filter(port => !portIds.includes(port)).length,
      segmentCount: segments.length, foreignSegmentCount: foreign.length,
      omittedSegmentCount: segments.length - selected.length,
      segments: selected.map(([ownerRouteId, fromPortId, toPortId]) => ({
        ownerRouteId, ownerNetId: problem.routeNet[ownerRouteId!],
        ownerConnectionId: problem.routeMetadata?.[ownerRouteId!]?.connectionId ?? null,
        fixed: problem.routeIsFixed ? problem.routeIsFixed[ownerRouteId!] === 1 : null,
        from: point(fromPortId!), to: point(toPortId!),
      })),
    }
  }
  const installInner = (solver: RuntimeObject): void => {
    assert.equal(inner, undefined, "A target phase unexpectedly created a second solveGraph instance")
    inner = solver
    assert(report && pathing)
    const { problem, topology } = solver
    const routeCount = requiredNumber(problem.routeCount, "problem.routeCount")
    if (options.verifyInitialQueueOrder) {
      assert.equal(solver.iterations, 0, "Initial queue observer must precede routing")
      assert.equal(solver._setupDone, false, "Initial queue observer must precede setup")
      assert(routeCount <= 4096, "Initial queue ledger exceeds the diagnostic bound")
      const descriptor = Object.getOwnPropertyDescriptor(solver, "_setup")
      const setup = solver._setup
      assert.equal(typeof setup, "function")
      solver._setup = function (this: RuntimeObject, ...args: unknown[]): unknown {
        assert.equal(this, solver)
        assert.equal(report!.initialQueueOrder, undefined, "Initial setup ran more than once")
        const beforeIds: number[] = [...this.state.unroutedRoutes]
        const problemBefore = serialize(problem)
        const topologyBefore = serialize(topology)
        let result: unknown
        try { result = Reflect.apply(setup, this, args) }
        finally { restoreMethod(this, "_setup", descriptor) }
        assert.equal(this.problem, problem)
        assert.equal(this.topology, topology)
        const problemAfter = serialize(problem)
        const topologyAfter = serialize(topology)
        assert(problemBefore.equals(problemAfter), "Initial scheduling changed canonical problem data")
        assert(topologyBefore.equals(topologyAfter), "Initial scheduling changed canonical topology data")
        const afterIds: number[] = [...this.state.unroutedRoutes]
        assert.equal(new Set(beforeIds).size, beforeIds.length)
        assert(beforeIds.every(id => Number.isInteger(id) && id >= 0 && id < routeCount))
        assert.deepEqual([...afterIds].sort((a, b) => a - b), [...beforeIds].sort((a, b) => a - b), "Initial scheduling changed pending route IDs")
        assert.deepEqual(afterIds.map(id => problem.routeNet[id]), beforeIds.map(id => problem.routeNet[id]), "Initial scheduling changed physical-net slots")
        const sameLayer = (id: number): boolean => topology.portZ[problem.routeStartPort[id]] === topology.portZ[problem.routeEndPort[id]]
        for (const netId of new Set(beforeIds.map(id => problem.routeNet[id]))) {
          const beforeNet = beforeIds.filter(id => problem.routeNet[id] === netId)
          const expected = [...beforeNet.filter(sameLayer), ...beforeNet.filter(id => !sameLayer(id))]
          assert.deepEqual(afterIds.filter(id => problem.routeNet[id] === netId), expected, "Initial scheduling must preserve order within each endpoint-layer class")
        }
        const pending = new Set(beforeIds)
        const excludedIds = Array.from({ length: routeCount }, (_, id) => id).filter(id => !pending.has(id))
        assert(excludedIds.every(id => !afterIds.includes(id)), "Initial scheduling reintroduced excluded fixed/preloaded routes")
        const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
        report!.initialQueueOrder = {
          verified: true, hookBeforeFirstSetup: true, routeCount,
          beforeIds, afterIds, excludedIds,
          sameLayerCount: beforeIds.filter(sameLayer).length,
          crossLayerCount: beforeIds.filter(id => !sameLayer(id)).length,
          changedSlots: afterIds.filter((id, index) => id !== beforeIds[index]).length,
          problemBeforeSha256: digest(problemBefore), problemAfterSha256: digest(problemAfter),
          topologyBeforeSha256: digest(topologyBefore), topologyAfterSha256: digest(topologyAfter),
          canonicalDataExact: true, queuedIdPermutation: true, netSlotsStable: true,
          layerClassOrderStable: true, excludedRoutesRemainExcluded: true,
        }
        options.onSnapshot(report!)
        return result
      }
      restorations.push(() => restoreMethod(solver, "_setup", descriptor))
    }
    assert.equal(solver.routeAttemptCountByRouteId.length, routeCount)
    assert.equal(solver.routeSuccessCountByRouteId.length, routeCount)
    const pipeline = pathing.tinyPipelineSolver
    const serialized = pipeline.inputProblem.serializedHyperGraph
    assert(Array.isArray(serialized.connections))
    const preloadedAssignments = problem.initialAssignments
    const preloadCount = requiredNumber(pipeline.preloadedFixedSegmentCount, "preloaded assignment count")
    const usesPreloadedPartialRip = pipeline.preloadedPortCount > 0 && pathing.params.flags.USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES === true
    report.configured = {
      className: solver.constructor.name,
      hookInstalledAtIteration: requiredNumber(solver.iterations, "iterations"),
      routeCount, portCount: requiredNumber(topology.portCount, "topology.portCount"),
      regionCount: requiredNumber(topology.regionCount, "topology.regionCount"),
      serializedPortCount: serialized.ports.length,
      serializedConnectionCount: serialized.connections.length,
      MAX_ITERATIONS: requiredNumber(solver.MAX_ITERATIONS, "MAX_ITERATIONS"),
      solveGraphOptions: { ...pipeline.inputProblem.solveGraphOptions },
      partialRipEnabled: solver.PARTIAL_RIP_ENABLED,
      outsideInRouting: solver.OUTSIDE_IN_ROUTING,
      initialAssignmentCount: preloadedAssignments?.length ?? null,
      fixedRouteCount: problem.routeIsFixed ? Array.from(problem.routeIsFixed as Uint8Array).filter(value => value === 1).length : null,
      reportedPreloadedAssignmentCount: preloadCount,
      partialRipEligibilityCount: usesPreloadedPartialRip ? Math.max(serialized.connections.length, preloadCount) : serialized.connections.length,
      pathingEffort: pathing.params.effort,
      pathingFlags: { ...pathing.params.flags },
      denseWorkspaceSupported: solver.geometry?.supported ?? null,
    }
    assert.equal(typeof report.configured.partialRipEnabled, "boolean")
    assert.equal(typeof report.configured.outsideInRouting, "boolean")
    let previousRouteEventIteration = solver.iterations
    const counts = { pathFoundCalls: 0, pathsCommitted: 0, goalApproachesQueued: 0, rejectedGoalApproaches: 0, nonfiniteGoalApproachesWithoutPriorGoal: 0, rejectionsWithExistingGoalCandidate: 0, exhaustedSearches: 0, globalResets: 0, finalAcceptances: 0 }
    const longestAttempts: RuntimeObject[] = []
    const recentRecovery: RuntimeObject[] = []
    report.lifecycleCounts = counts
    report.longestRouteEventIntervals = longestAttempts
    report.recentRecovery = recentRecovery
    const snapshot = (): RuntimeObject => {
      const state = solver.state
      const pending = new Set<number>(state.unroutedRoutes)
      if (state.currentRouteId !== undefined) pending.add(state.currentRouteId)
      return {
        iterations: solver.iterations, MAX_ITERATIONS: solver.MAX_ITERATIONS,
        iterationsSincePreviousRouteEvent: solver.iterations - previousRouteEventIteration,
        solved: solver.solved, failed: solver.failed, error: solver.error,
        currentRoute: routeDetail(solver, state.currentRouteId), pendingRouteCount: pending.size,
        candidateQueueLength: requiredNumber(state.candidateQueue.length, "candidateQueue.length"),
        ripCount: state.ripCount,
        neverAttemptedCount: Array.from(solver.routeAttemptCountByRouteId as Uint32Array).filter(value => value === 0).length,
        neverSuccessfullyRouted: solver.getNeverSuccessfullyRoutedRoutes(),
        routeAttempts: Array.from(solver.routeAttemptCountByRouteId as Uint32Array),
        routeSuccesses: Array.from(solver.routeSuccessCountByRouteId as Uint32Array),
        bestCompleteSnapshotPresent: Boolean(solver.bestSolvedStateSnapshot),
        firstCompletedRoundSummary: solver.firstCompletedRoundSummary ?? null,
        completedRoundSummaries: solver.completedRoundSummaries ?? null,
        partialRipRoutePlanCount: solver.partialRipRoutePlans instanceof Map ? solver.partialRipRoutePlans.size : null,
        selectiveRerip: solver.getSelectiveReripStats(), stats: { ...solver.stats },
      }
    }
    finalSnapshot = snapshot
    report.initial = snapshot()
    for (const name of ["onPathFound", "onOutOfCandidates", "resetRoutingStateForRerip", "tryFinalAcceptance"]) {
      const descriptor = Object.getOwnPropertyDescriptor(solver, name)
      const original = solver[name]
      assert.equal(typeof original, "function", `Published solver is missing ${name}`)
      solver[name] = function (this: RuntimeObject, ...args: unknown[]): unknown {
        const iteration = this.iterations
        const routeId = this.state.currentRouteId
        const queueLength = this.state.candidateQueue.length
        const goalApproach = name === "onPathFound" && (args[0] as RuntimeObject)?.portId !== this.state.goalPortId
        const previousGoalCost = goalApproach ? this.getCandidateBestCost(this.getHopId(this.state.goalPortId, (args[0] as RuntimeObject).nextRegionId)) : null
        let observedGoalCost: unknown = null
        const before = name === "tryFinalAcceptance" ? snapshot() : undefined
        if (name === "onOutOfCandidates" && !report!.firstExhaustedSearch) {
          report!.firstExhaustedSearch = { iteration, route: routeDetail(this, routeId), queueLength: this.state.candidateQueue.length }
        }
        const costDescriptor = Object.getOwnPropertyDescriptor(this, "computeG")
        const computeG = this.computeG
        const captureGoalCost = goalApproach && !report!.firstRejectedGoalApproach
        if (captureGoalCost) {
          assert.equal(typeof computeG, "function")
          this.computeG = function (this: RuntimeObject, ...costArgs: unknown[]): unknown {
            const cost = Reflect.apply(computeG, this, costArgs)
            if (costArgs[1] === this.state.goalPortId) observedGoalCost = cost
            return cost
          }
        }
        let result: unknown
        try { result = Reflect.apply(original, this, args) }
        finally { if (captureGoalCost) restoreMethod(this, "computeG", costDescriptor) }
        const committed = name === "onPathFound" && this.state.currentRouteId !== routeId
        if (name === "onPathFound") {
          counts.pathFoundCalls++
          if (committed) counts.pathsCommitted++
          else if (goalApproach && this.getCandidateBestCost(this.getHopId(this.state.goalPortId, (args[0] as RuntimeObject).nextRegionId)) === previousGoalCost) {
            counts.rejectedGoalApproaches++
            if (previousGoalCost === Infinity) counts.nonfiniteGoalApproachesWithoutPriorGoal++
            else counts.rejectionsWithExistingGoalCandidate++
            if (!report!.firstRejectedGoalApproach) report!.firstRejectedGoalApproach = {
              iteration, route: routeDetail(this, routeId), candidatePortId: (args[0] as RuntimeObject).portId,
              regionId: (args[0] as RuntimeObject).nextRegionId, queueLength,
              cost: observedGoalCost === Infinity ? "Infinity" : observedGoalCost,
              previousGoalCost: previousGoalCost === Infinity ? "Infinity" : previousGoalCost,
              region: regionWitness(this, (args[0] as RuntimeObject).nextRegionId, (args[0] as RuntimeObject).portId),
            }
            if (previousGoalCost === Infinity && !report!.firstNonfiniteGoalApproachWithoutPriorGoal) {
              report!.firstNonfiniteGoalApproachWithoutPriorGoal = {
                iteration, route: routeDetail(this, routeId), candidatePortId: (args[0] as RuntimeObject).portId,
                regionId: (args[0] as RuntimeObject).nextRegionId, queueLength,
                cost: observedGoalCost === Infinity ? "Infinity" : observedGoalCost ?? "nonfinite; inferred from unchanged infinite goal cost, not recomputed",
                region: regionWitness(this, (args[0] as RuntimeObject).nextRegionId, (args[0] as RuntimeObject).portId),
              }
            }
          } else if (goalApproach) counts.goalApproachesQueued++
        }
        if (committed || name === "onOutOfCandidates") {
          if (name === "onOutOfCandidates") counts.exhaustedSearches++
          longestAttempts.push({ routeId, event: name, iteration, iterationsSincePreviousRouteEvent: iteration - previousRouteEventIteration })
          longestAttempts.sort((a, b) => b.iterationsSincePreviousRouteEvent - a.iterationsSincePreviousRouteEvent)
          longestAttempts.length = Math.min(longestAttempts.length, 12)
          previousRouteEventIteration = iteration
        }
        if (name === "onOutOfCandidates" || name === "resetRoutingStateForRerip") {
          if (name === "resetRoutingStateForRerip") counts.globalResets++
          const recovery = { event: name, iteration, routeId, ripCount: this.state.ripCount, ...this.getSelectiveReripStats() }
          if (report!.firstExhaustedSearch && !report!.firstExhaustedSearch.recovery && name === "onOutOfCandidates") report!.firstExhaustedSearch.recovery = recovery
          recentRecovery.push(recovery)
          if (recentRecovery.length > 8) recentRecovery.shift()
        }
        if (name === "tryFinalAcceptance") {
          counts.finalAcceptances++
          report!.finalAcceptance = { before, after: snapshot() }
        }
        return result
      }
      restorations.push(() => restoreMethod(solver, name, descriptor))
    }
    options.onSnapshot(report)
  }
  return {
    onSolverStarted(event: RuntimeObject, phase: string | undefined): void {
      if (!options.targetPhase || phase !== options.targetPhase || event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph") return
      assert.equal(report, null, "Target phase started more than once")
      const input = event.solverParams?.input
      assert(input && Array.isArray(input.connections), "Missing actual phase solver input")
      report = { instrumentation: "published-instance lifecycle observer; no routing options changed", phase, inputNetCount: input.connections.length }
      const prototype = options.pipelineClass.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "step")
      const original = prototype.step
      assert.equal(typeof original, "function")
      prototype.step = function (this: RuntimeObject, ...args: unknown[]): unknown {
        if (!observedPipeline) {
          // The published constructor copies SRJ to normalize obstacle layers;
          // its connection/trace arrays retain their original identity.
          assert.equal(this.originalSrj.connections, input.connections, "Observer and Core must own the same phase connections")
          assert.equal(this.originalSrj.traces, input.traces, "Observer and Core must own the same preloaded copper")
          observedPipeline = this
        }
        assert.equal(this, observedPipeline, "Another pipeline entered the target observer")
        const result = Reflect.apply(original, this, args)
        if (this.portPointPathingSolver && !pathing) {
          pathing = this.portPointPathingSolver
          restoreMethod(prototype, "step", descriptor)
          const pathingDescriptor = Object.getOwnPropertyDescriptor(pathing, "step")
          const pathingStep = pathing.step
          pathing.step = function (this: RuntimeObject, ...childArgs: unknown[]): unknown {
            const childResult = Reflect.apply(pathingStep, this, childArgs)
            const candidate = this.tinyPipelineSolver.getSolver("solveGraph")
            if (candidate && !inner) {
              installInner(candidate)
              restoreMethod(this, "step", pathingDescriptor)
            }
            return childResult
          }
          restorations.push(() => restoreMethod(pathing!, "step", pathingDescriptor))
        }
        return result
      }
      restorations.push(() => restoreMethod(prototype, "step", descriptor))
    },
    finish(): RuntimeObject | null {
      if (options.verifyInitialQueueOrder && inner) assert.equal(report?.initialQueueOrder?.verified, true, "Native initial queue policy was not observed")
      if (report && finalSnapshot) report.final = finalSnapshot()
      if (report) report.innerHookInstalled = Boolean(inner)
      for (const restore of restorations.reverse()) restore()
      return report
    },
  }
}

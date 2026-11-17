import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
type RetainedSolver = { solver: RuntimeObject; attempt: number | null; events: RuntimeObject }
const MAX_CHILDREN = 8
const OPTION_FIELDS = ["minViaPadDiameter", "DISTANCE_TO_COST", "RIP_THRESHOLD_START", "RIP_THRESHOLD_END",
  "RIP_THRESHOLD_RAMP_ATTEMPTS", "RIP_CONGESTION_REGION_COST_FACTOR", "TRACE_DENSITY_COST_FACTOR",
  "MAX_ITERATIONS", "STATIC_REACHABILITY_PRECHECK", "ACCEPT_BEST_SOLUTION_ON_TIMEOUT",
  "GREEDY_FINAL_ROUTE_ITERS", "PARTIAL_RIP_ENABLED", "OUTSIDE_IN_ROUTING", "costAwareFinalReripBudget", "remainingReripBudget"]

const select = (source: RuntimeObject, fields: string[]): RuntimeObject => Object.fromEntries(fields
  .filter((field) => source[field] !== undefined).map((field) => [field, source[field]]))

/** Retain real failed search objects; inspect them only after routing stops. */
export function createCoarseFailureObserver(): {
  afterPipelineStep: (pipeline: RuntimeObject) => void
  finish: () => { report: RuntimeObject; numericSnapshot: RuntimeObject | null }
  dispose: () => void
} {
  const report: RuntimeObject = { observationErrors: [], recoveryChildrenCreated: 0 }
  const retained: RetainedSolver[] = []
  const restorations: (() => void)[] = []
  let finished = false
  let originalPreloadedSegmentKeys: Array<[string, string[]]> = []
  const observe = (event: string, operation: () => void): void => {
    try { operation() }
    catch (error) { report.observationErrors.push({ event, message: String(error).slice(0, 2048) }) }
  }
  const wrap = (solver: RuntimeObject, name: string, make: (original: (...args: any[]) => any) => (...args: any[]) => any): void => {
    const descriptor = Object.getOwnPropertyDescriptor(solver, name)
    const original = solver[name]
    assert.equal(typeof original, "function", `Missing observed coarse method ${name}`)
    Object.defineProperty(solver, name, { configurable: true, writable: true, value: make(original) })
    restorations.push(() => {
      if (descriptor) Object.defineProperty(solver, name, descriptor)
      else delete solver[name]
    })
  }
  const retain = (solver: RuntimeObject, attempt: number | null): void => {
    const events: RuntimeObject = { previousRouteEventIteration: solver.iterations, lastAccountedIteration: solver.iterations,
      installedIteration: solver.iterations, accounting: "Route-event intervals include setup and control steps; not exact A* pops", perRouteIterations: Array(solver.problem.routeCount).fill(0), unattributedIterations: 0,
      committedPaths: 0, exhaustedSearches: 0, globalResets: 0, longestRouteIntervals: [], recentRecovery: [], firstEvents: [], lastEvents: [], eventCount: 0 }
    retained.push({ solver, attempt, events })
    for (const name of ["onPathFound", "onOutOfCandidates", "resetRoutingStateForRerip"]) {
      wrap(solver, name, (original) => function (this: RuntimeObject, ...args: any[]): any {
        const iteration = this.iterations
        const routeId = this.state.currentRouteId
        const queueLength = this.state.candidateQueue.length
        observe("iteration-accounting", () => {
          const iterations = iteration - events.lastAccountedIteration
          assert(iterations >= 0)
          if (routeId === undefined) events.unattributedIterations += iterations
          else events.perRouteIterations[routeId] += iterations
          events.lastAccountedIteration = iteration
        })
        const result = Reflect.apply(original, this, args)
        observe(name, () => {
          const event = { event: name, iteration, routeBefore: routeId, routeAfter: this.state.currentRouteId,
            queueBefore: queueLength, queueAfter: this.state.candidateQueue.length, ripCount: this.state.ripCount }
          events.eventCount++
          if (events.firstEvents.length < 16) events.firstEvents.push(event)
          events.lastEvents.push(event)
          if (events.lastEvents.length > 16) events.lastEvents.shift()
          const committed = name === "onPathFound" && this.state.currentRouteId !== routeId
          if (committed) events.committedPaths++
          if (name === "onOutOfCandidates") events.exhaustedSearches++
          if (name === "resetRoutingStateForRerip") events.globalResets++
          if (committed || name === "onOutOfCandidates") {
            events.longestRouteIntervals.push({ routeId, event: name, iteration, iterations: iteration - events.previousRouteEventIteration })
            events.longestRouteIntervals.sort((a: RuntimeObject, b: RuntimeObject) => b.iterations - a.iterations)
            events.longestRouteIntervals.length = Math.min(12, events.longestRouteIntervals.length)
            events.previousRouteEventIteration = iteration
          }
          if (name === "onOutOfCandidates" || name === "resetRoutingStateForRerip") {
            events.recentRecovery.push({ routeId, event: name, iteration, ripCount: this.state.ripCount,
              selectiveRerip: typeof this.getSelectiveReripStats === "function" ? this.getSelectiveReripStats() : null })
            if (events.recentRecovery.length > 8) events.recentRecovery.shift()
          }
        })
        return result
      })
    }
  }
  const routeMetadata = (metadata: RuntimeObject): RuntimeObject => ({
    ...select(metadata, ["connectionId", "mutuallyConnectedNetworkId", "preloadedTraceSection"]),
    ...(metadata.simpleRouteConnection ? { simpleRouteConnection: {
      ...select(metadata.simpleRouteConnection, ["name", "__rootConnectionNames"]),
      pointsToConnect: metadata.simpleRouteConnection.pointsToConnect?.map((point: RuntimeObject) =>
        select(point, ["x", "y", "layers", "pcb_port_id", "pointId", "portId"])),
    } } : {}),
  })
  const summarizeSolver = ({ solver, attempt, events }: RetainedSolver): RuntimeObject => {
    const { topology, problem, state } = solver
    const remainingIterations = solver.iterations - events.lastAccountedIteration
    if (state.currentRouteId === undefined) events.unattributedIterations += remainingIterations
    else events.perRouteIterations[state.currentRouteId] += remainingIterations
    events.lastAccountedIteration = solver.iterations
    assert.equal(events.perRouteIterations.reduce((sum: number, iterations: number) => sum + iterations, 0) + events.unattributedIterations, solver.iterations - events.installedIteration, "Route interval accounting did not reconcile")
    const committedIds = [...new Set<number>(state.regionSegments.flatMap((segments: number[][]) => segments.map((segment) => segment[0])))].sort((a, b) => a - b)
    const pendingIds = [...new Set<number>([...state.unroutedRoutes, ...(state.currentRouteId === undefined ? [] : [state.currentRouteId])])]
    const currentRouteId = state.currentRouteId
    const routePlan = solver.partialRipRoutePlans?.get(currentRouteId)
    const startPortId = currentRouteId === undefined ? null : solver.getRouteStartPortId(currentRouteId)
    const endPortId = currentRouteId === undefined ? null : solver.getRouteEndPortId(currentRouteId)
    const point = (portId: number | null): RuntimeObject | null => portId === null ? null : ({ portId,
      x: topology.portX[portId], y: topology.portY[portId], z: topology.portZ[portId],
      serializedPortId: topology.portMetadata?.[portId]?.serializedPortId })
    return {
      attempt, className: solver.constructor.name, iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
      solved: solver.solved, failed: solver.failed, error: solver.error,
      options: select(solver, [...new Set([...OPTION_FIELDS, ...Object.keys(solver).filter((field) => /^[A-Z_]+$/.test(field))])]), stats: structuredClone(solver.stats),
      selectiveRerip: typeof solver.getSelectiveReripStats === "function" ? solver.getSelectiveReripStats() : null,
      currentRouteId, currentRouteNetId: state.currentRouteNetId,
      currentRouteMetadata: currentRouteId === undefined ? null : routeMetadata(problem.routeMetadata[currentRouteId]),
      startingNextRegionId: currentRouteId === undefined ? null : solver.getStartingNextRegionId(currentRouteId, startPortId),
      currentStart: point(startPortId), currentEnd: point(endPortId), goal: point(state.goalPortId >= 0 ? state.goalPortId : null),
      activePartialRipPlan: routePlan ? structuredClone(routePlan) : null,
      pendingRouteIds: pendingIds, committedOwnerRouteIds: committedIds, committedOwnerRouteCount: committedIds.length,
      committedOwnersCanContainPartialRoutes: true,
      candidateQueueLength: state.candidateQueue.length, candidateQueueClass: state.candidateQueue.constructor.name,
      candidateHopCapacity: solver.candidateHopCapacity, directedIncidentHopCount: topology.incidentPortRegion.reduce((sum: number, regions: number[]) => sum + regions.length, 0),
      queuedCandidates: state.candidateQueue.toArray().slice(0, 8).map((candidate: RuntimeObject) => select(candidate, ["portId", "nextRegionId", "prevRegionId", "g", "h", "f"])),
      ripCount: state.ripCount, routeAttempts: Array.from(solver.routeAttemptCountByRouteId),
      routeSuccesses: Array.from(solver.routeSuccessCountByRouteId),
      bestCompleteSnapshotPresent: Boolean(solver.bestSolvedStateSnapshot),
      partialRipRoutePlanCount: solver.partialRipRoutePlans instanceof Map ? solver.partialRipRoutePlans.size : 0,
      firstCompletedRoundSummary: structuredClone(solver.firstCompletedRoundSummary),
      completedRoundSummaries: structuredClone(solver.completedRoundSummaries),
      events: { ...events, iterationsSincePreviousRouteEvent: solver.iterations - events.previousRouteEventIteration,
        topRouteIterationTotals: events.perRouteIterations.map((iterations: number, routeId: number) => ({ routeId, iterations,
          connectionId: problem.routeMetadata[routeId].connectionId })).sort((a: RuntimeObject, b: RuntimeObject) => b.iterations - a.iterations).slice(0, 12) },
    }
  }
  const dispose = (): void => {
    for (const restore of restorations.splice(0).reverse()) restore()
  }
  return {
    afterPipelineStep(pipeline: RuntimeObject): void {
      if (finished || retained.length > 0 || report.observationErrors.length > 0) return
      const pathing = pipeline.portPointPathingSolver
      const tiny = pathing?.tinyPipelineSolver?.getSolver("solveGraph")
      if (!tiny) return
      observe("install", () => {
        assert.equal(tiny.iterations, 0, "Must retain coarse solver before its first search step")
        report.installedAtIteration = tiny.iterations
        assert(pathing.originalPreloadedSegmentKeysByConnectionId instanceof Map, "Original physical preload assignment map unavailable")
        originalPreloadedSegmentKeys = [...pathing.originalPreloadedSegmentKeysByConnectionId].map(([connectionId, keys]: [string, Set<string>]) => [connectionId, [...keys]])
        report.originalPreloadSectionCount = originalPreloadedSegmentKeys.length
        retain(tiny, null)
        wrap(tiny, "createGreedyFinalRouteSolver", (original) => function (this: RuntimeObject, ...args: any[]): any {
          const child = Reflect.apply(original, this, args)
          observe("retain-recovery-child", () => {
            report.recoveryChildrenCreated++
            assert(retained.length <= MAX_CHILDREN, "Recovery child observation exceeded scope")
            retain(child, args[1])
          })
          return child
        })
      })
    },
    finish(): { report: RuntimeObject; numericSnapshot: RuntimeObject | null } {
      assert(!finished, "Coarse failure observer already finalized")
      finished = true
      let numericSnapshot: RuntimeObject | null = null
      try {
        observe("final-coarse-state", () => {
          assert(retained.length > 0, "No owned coarse solver retained")
          report.solvers = retained.map(summarizeSolver)
          const primary = retained[0].solver
          for (const entry of retained) {
            assert.equal(entry.solver.topology, primary.topology, "Recovery topology changed")
            assert.equal(entry.solver.problem, primary.problem, "Recovery problem changed")
          }
          const topology = select(primary.topology, ["portCount", "regionCount", "regionIncidentPorts", "incidentPortRegion",
            "regionWidth", "regionHeight", "regionCenterX", "regionCenterY", "regionAvailableZMask",
            "portAngleForRegion1", "portAngleForRegion2", "portX", "portY", "portZ"])
          const problem = select(primary.problem, ["routeCount", "portSectionMask", "routeStartPort", "routeEndPort", "routeNet",
            "routeIsFixed", "regionNetId", "portPenalty", "initialAssignments", "physicalViaReservationsByRegion"])
          numericSnapshot = {
            interpretation: "Post-routing numeric state for offline reachability analysis; no routing or scoring was performed by this observer",
            topology, problem, originalPreloadedSegmentKeys,
            routeMetadata: primary.problem.routeMetadata.map(routeMetadata),
            regionNames: primary.topology.regionMetadata.map((metadata: RuntimeObject) => select(metadata, ["serializedRegionId", "capacityMeshNodeId"])),
            portNames: primary.topology.portMetadata.map((metadata: RuntimeObject) => metadata.serializedPortId),
            portEndpointReservationNetId: primary.problemSetup.portEndpointReservationNetId,
            states: retained.map(({ solver, attempt }) => {
              const cacheHash = createHash("sha256")
              for (const cache of solver.state.regionIntersectionCaches) {
                cacheHash.update(JSON.stringify([cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections,
                  cache.existingEntryExitLayerChanges, cache.existingRegionCost, cache.existingSegmentCount,
                  Array.from(cache.netIds), Array.from(cache.lesserAngles), Array.from(cache.greaterAngles), Array.from(cache.layerMasks)],
                  (_key, value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value))
                cacheHash.update("\n")
              }
              return {
                attempt, ...select(solver.state, ["portAssignment", "regionCongestionCost", "currentRouteId",
                  "currentRouteNetId", "unroutedRoutes", "goalPortId", "ripCount"]),
                nonemptyRegionSegments: solver.state.regionSegments.flatMap((segments: number[][], regionId: number) => segments.length ? [[regionId, segments]] : []),
                regionIntersectionCachesSha256: cacheHash.digest("hex"),
                routeAttempts: solver.routeAttemptCountByRouteId, routeSuccesses: solver.routeSuccessCountByRouteId,
                partialRipRoutePlans: solver.partialRipRoutePlans instanceof Map ? [...solver.partialRipRoutePlans] : [],
              }
            }),
          }
          assert(Buffer.byteLength(JSON.stringify(report)) <= 256 * 1024, "Coarse summaries exceeded 256 KiB")
        })
      } finally { dispose() }
      return { report, numericSnapshot }
    },
    dispose,
  }
}

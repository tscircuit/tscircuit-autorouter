import assert from "node:assert/strict"

type RuntimeObject = Record<string, any>
type Options = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  targetPhase: string | undefined
  onSnapshot: (report: RuntimeObject) => void
}

// Slow routes from the retained Glider run and adjacent controls. Identities are
// read from the actual new solver; they are not inferred from SRJ array order.
const selectedRouteIds = new Set([18, 19, 22, 23])
const samplePops = new Set([1, 1024, 8192, 32768, 65536, 98304, 114688, 120000])
const jsonNumber = (value: number): number | string => Number.isFinite(value) ? value : String(value)

/** Observe published instances only. Timings from this run are diagnostic. */
export function createCoarseFailureDiagnostics(options: Options): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass)
  let report: RuntimeObject | null = null
  let inner: RuntimeObject | undefined
  let pipeline: RuntimeObject | undefined
  let pathing: RuntimeObject | undefined
  const restorations: (() => void)[] = []

  // Another observer may already have removed its own outer hook while our
  // wrapper is running. Never reinstall a captured wrapper in that case.
  const wrap = (object: RuntimeObject, name: string, observe: (original: Function, self: RuntimeObject, args: any[]) => any): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)
    const original = object[name]
    assert.equal(typeof original, "function", `Missing published method ${name}`)
    const wrapper = function (this: RuntimeObject, ...args: any[]): any {
      return observe(original, this, args)
    }
    object[name] = wrapper
    const restore = (): void => {
      if (object[name] !== wrapper) return
      if (descriptor) Object.defineProperty(object, name, descriptor)
      else delete object[name]
    }
    restorations.push(restore)
    return restore
  }

  const installInner = (solver: RuntimeObject): void => {
    assert.equal(inner, undefined)
    assert.equal(solver.iterations, 0, "Coarse witness must start before routing")
    inner = solver
    const { state, topology, problem } = solver
    const queue = state.candidateQueue
    const capacity = solver.candidateHopCapacity
    assert(Number.isInteger(capacity) && capacity > 0 && capacity <= 2_000_000, "Unexpected compact hop capacity")
    assert(state.candidateBestCostByHopId instanceof Float64Array)
    assert(state.candidateBestCostGenerationByHopId instanceof Uint32Array)
    const seen = new Uint8Array(capacity)
    const negativeHops = new Set<number>()
    const point = (portId: number): RuntimeObject => ({
      portId, x: topology.portX[portId], y: topology.portY[portId], z: topology.portZ[portId],
      incidentRegions: [...topology.incidentPortRegion[portId]],
    })
    const detail = (routeId: number): RuntimeObject => {
      const metadata = problem.routeMetadata?.[routeId]
      const connection = metadata?.simpleRouteConnection
      return {
        routeId, netId: problem.routeNet[routeId], connectionId: metadata?.connectionId ?? null,
        connectionName: connection?.name ?? null, rootConnectionNames: connection?.__rootConnectionNames ?? null,
        start: point(problem.routeStartPort[routeId]), end: point(problem.routeEndPort[routeId]),
        terminals: connection?.pointsToConnect?.slice(0, 4).map((p: RuntimeObject) => ({
          pointId: p.pointId ?? null, pcbPortId: p.pcb_port_id ?? null, x: p.x, y: p.y, layers: p.layers ?? null,
        })) ?? null,
      }
    }
    const counts = {
      mainStepCalls: 0, queueDequeueCalls: 0, emptyQueuePops: 0, staleQueuePops: 0,
      foreignRegionPops: 0, eligibleExpansions: 0, stepsWithoutQueuePop: 0,
      stepsWithMultipleQueuePops: 0, stepsWithReplacedQueue: 0,
    }
    const portCountByZ: RuntimeObject = {}
    for (const z of topology.portZ) portCountByZ[z] = (portCountByZ[z] ?? 0) + 1
    Object.assign(report!, {
      configured: {
        hookInstalledAtIteration: solver.iterations, routeCount: problem.routeCount,
        portCount: topology.portCount, regionCount: topology.regionCount, portCountByZ,
        candidateHopCapacity: capacity, candidateHopSlotStride: solver.candidateHopSlotStride,
        MAX_ITERATIONS: solver.MAX_ITERATIONS, denseWorkspaceSupported: solver.geometry?.supported ?? null,
        distanceToCost: solver.DISTANCE_TO_COST, addSegmentDistanceToG: solver.ADD_SEGMENT_DISTANCE_TO_G,
        selectedRoutes: [...selectedRouteIds].map(detail),
      },
      counts, attempts: [],
      counterMeaning: "Eligible expansion excludes only the stale/foreign-region early returns; it includes dead ends and goal handling. Duplicate-hop counts and f ties cover selected attempts only. Child recovery solvers are not counted.",
    })
    let active: RuntimeObject | undefined
    let previousF: number | undefined
    let equalFRun = 0
    const attempt = (): RuntimeObject | undefined => {
      const routeId = state.currentRouteId
      if (!selectedRouteIds.has(routeId)) return undefined
      const attemptNumber = solver.routeAttemptCountByRouteId[routeId]
      if (attemptNumber > 2) return undefined
      if (active && active.routeId === routeId && active.attemptNumber === attemptNumber) return active
      seen.fill(0)
      negativeHops.clear()
      previousF = undefined
      equalFRun = 0
      active = {
        routeId, attemptNumber, firstIteration: solver.iterations, goal: point(state.goalPortId),
        pops: 0, emptyPops: 0, stalePops: 0, foreignRegionPops: 0, eligibleExpansions: 0,
        repeatedHopPops: 0, untrackedHopPops: 0, exactAdjacentFTies: 0, longestEqualFRun: 0,
        fDecreases: 0, minF: Infinity, maxF: -Infinity, poppedByZ: {}, poppedByRegionZMask: {},
        goalApproaches: 0, goalCosts: [], samples: [],
      }
      report!.attempts.push(active)
      return active
    }
    const candidateDetail = (candidate: RuntimeObject): RuntimeObject => ({
      iteration: solver.iterations, hopId: candidate.hopId, ...point(candidate.portId),
      nextRegionId: candidate.nextRegionId, regionZMask: topology.regionAvailableZMask?.[candidate.nextRegionId] ?? null,
      g: jsonNumber(candidate.g), h: jsonNumber(candidate.h), f: jsonNumber(candidate.f), queueLength: queue.length,
    })

    wrap(solver, "_step", (original, self, args) => {
      counts.mainStepCalls++
      if (self.state.candidateQueue !== queue) counts.stepsWithReplacedQueue++
      const before = counts.queueDequeueCalls
      try { return Reflect.apply(original, self, args) }
      finally {
        const pops = counts.queueDequeueCalls - before
        if (pops === 0) counts.stepsWithoutQueuePop++
        if (pops > 1) counts.stepsWithMultipleQueuePops++
      }
    })
    wrap(queue, "dequeue", (original, self, args) => {
      const candidate = Reflect.apply(original, self, args)
      counts.queueDequeueCalls++
      const row = attempt()
      if (!candidate) {
        counts.emptyQueuePops++
        if (row) row.emptyPops++
        return candidate
      }
      const hop = candidate.hopId
      assert(Number.isInteger(hop), "Published indexed queue did not assign a hop ID")
      const best = hop < 0 ? (solver.candidateOverflowBestCost?.get(hop) ?? Infinity)
        : state.candidateBestCostGenerationByHopId[hop] === state.candidateBestCostGeneration
          ? state.candidateBestCostByHopId[hop] : Infinity
      const stale = candidate.g > best
      const reserved = problem.regionNetId[candidate.nextRegionId]
      const foreign = !stale && reserved !== -1 && reserved !== state.currentRouteNetId
      if (stale) counts.staleQueuePops++
      else if (foreign) counts.foreignRegionPops++
      else counts.eligibleExpansions++
      if (!row) return candidate
      row.pops++
      if (stale) row.stalePops++
      else if (foreign) row.foreignRegionPops++
      else row.eligibleExpansions++
      if (hop >= 0 && hop < seen.length) {
        if (seen[hop]) row.repeatedHopPops++
        seen[hop] = 1
      } else if (negativeHops.has(hop)) row.repeatedHopPops++
      else if (negativeHops.size < 1024) negativeHops.add(hop)
      else row.untrackedHopPops++
      equalFRun = candidate.f === previousF ? equalFRun + 1 : 1
      if (equalFRun > 1) row.exactAdjacentFTies++
      if (previousF !== undefined && candidate.f < previousF) row.fDecreases++
      previousF = candidate.f
      row.longestEqualFRun = Math.max(row.longestEqualFRun, equalFRun)
      row.minF = Math.min(row.minF, candidate.f)
      row.maxF = Math.max(row.maxF, candidate.f)
      const z = topology.portZ[candidate.portId]
      const mask = topology.regionAvailableZMask?.[candidate.nextRegionId] ?? "unknown"
      row.poppedByZ[z] = (row.poppedByZ[z] ?? 0) + 1
      row.poppedByRegionZMask[mask] = (row.poppedByRegionZMask[mask] ?? 0) + 1
      if (samplePops.has(row.pops)) row.samples.push(candidateDetail(candidate))
      return candidate
    })
    wrap(solver, "computeG", (original, self, args) => {
      const value = Reflect.apply(original, self, args)
      const row = attempt()
      if (row && args[1] === state.goalPortId && row.goalCosts.length < 8) {
        const candidate = args[0]
        const dx = topology.portX[candidate.portId] - topology.portX[state.goalPortId]
        const dy = topology.portY[candidate.portId] - topology.portY[state.goalPortId]
        const distance = self.ADD_SEGMENT_DISTANCE_TO_G ? Math.sqrt(dx * dx + dy * dy) * self.DISTANCE_TO_COST : 0
        const congestion = state.regionCongestionCost[candidate.nextRegionId]
        const penalty = problem.portPenalty?.[state.goalPortId] ?? 0
        const region = candidate.nextRegionId
        const cache = state.regionIntersectionCaches[region]
        row.goalCosts.push({
          ...candidateDetail(candidate), totalG: jsonNumber(value), distance, congestion, penalty,
          regionCostDeltaBySubtraction: Number.isFinite(value) ? value - candidate.g - distance - congestion - penalty : null,
          changesLayer: topology.portZ[candidate.portId] !== topology.portZ[state.goalPortId],
          region: {
            width: topology.regionWidth[region], height: topology.regionHeight[region],
            availableZMask: topology.regionAvailableZMask?.[region] ?? null,
            reservedNetId: problem.regionNetId[region],
            segmentCount: cache.existingSegmentCount, cost: jsonNumber(cache.existingRegionCost),
            sameLayerIntersections: cache.existingSameLayerIntersections,
            crossingLayerIntersections: cache.existingCrossingLayerIntersections,
            entryExitLayerChanges: cache.existingEntryExitLayerChanges,
          },
        })
      }
      return value
    })
    wrap(solver, "onPathFound", (original, self, args) => {
      const row = attempt()
      const routeId = state.currentRouteId
      if (row && args[0].portId !== state.goalPortId) {
        row.goalApproaches++
        row.firstGoalApproachIteration ??= self.iterations
      }
      const result = Reflect.apply(original, self, args)
      if (row && state.currentRouteId !== routeId) {
        row.committedAtIteration = self.iterations
        row.commitCandidate = candidateDetail(args[0])
        row.iterationsAfterFirstGoalApproach = row.firstGoalApproachIteration === undefined ? null : self.iterations - row.firstGoalApproachIteration
        options.onSnapshot(report!)
      }
      return result
    })
    options.onSnapshot(report!)
  }

  return {
    onSolverStarted(event, phase): void {
      if (!options.targetPhase || phase !== options.targetPhase || event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph") return
      assert.equal(report, null)
      const input = event.solverParams?.input
      assert(input && Array.isArray(input.connections))
      report = { instrumentation: "Pure published-instance coarse witness; unchanged inputs, ordering, costs and limits; timings are diagnostic", phase, inputNetCount: input.connections.length }
      const restorePipeline = wrap(options.pipelineClass.prototype, "step", (original, self, args) => {
        pipeline ??= self
        assert.equal(self, pipeline)
        assert.equal(self.originalSrj.connections, input.connections)
        assert.equal(self.originalSrj.traces, input.traces)
        const result = Reflect.apply(original, self, args)
        if (self.portPointPathingSolver && !pathing) {
          pathing = self.portPointPathingSolver
          restorePipeline()
          const restorePathing = wrap(pathing!, "step", (pathingStep, child, childArgs) => {
            const childResult = Reflect.apply(pathingStep, child, childArgs)
            const candidate = child.tinyPipelineSolver.getSolver("solveGraph")
            if (candidate && !inner) {
              installInner(candidate)
              restorePathing()
            }
            return childResult
          })
        }
        return result
      })
    },
    finish(): RuntimeObject | null {
      if (report) {
        report.innerHookInstalled = Boolean(inner)
        if (inner) report.final = { iterations: inner.iterations, solved: inner.solved, failed: inner.failed, error: inner.error, routeId: inner.state.currentRouteId ?? null }
      }
      for (const restore of restorations.reverse()) restore()
      return report
    },
  }
}

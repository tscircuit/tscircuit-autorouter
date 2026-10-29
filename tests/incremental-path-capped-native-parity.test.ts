import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { createIncrementalPathCappedFixture } from "./fixtures/createIncrementalPathCappedFixture"

test("never-admitted dense graphs preserve capped native rerips, ramp state and exact accept-best routes", async (): Promise<void> => {
  for (const maximum of [120, 240, 360, 720, 1200]) {
    const makeNative = (): PreparedPortPointRoutingSolver => {
      const x = createIncrementalPathCappedFixture()
      return new PreparedPortPointRoutingSolver(x.topology, x.problem, { ...x.options, MAX_ITERATIONS: maximum })
    }
    const makeExperiment = (): IncrementalPreparedPortPointRoutingSolver => {
      const x = createIncrementalPathCappedFixture()
      return new IncrementalPreparedPortPointRoutingSolver(x.topology, x.problem, { ...x.options, MAX_ITERATIONS: maximum })
    }
    const native = makeNative(), synchronous = makeExperiment(), asynchronous = makeExperiment()
    expect(synchronous.iterations).toBe(native.iterations)
    expect(synchronous.incrementalPath.chargedWork).toBe(0)
    expect(synchronous.incrementalPath.dependencyVisits).toBeGreaterThan(0)
    native.solve(); synchronous.solve(); await asynchronous.solveAsync()
    expect(native.solved).toBe(true)
    expect(native.stats.acceptedBestSolutionOnTimeout).toBe(true)
    expect(native.stats.ripCount).toBeGreaterThan(0)
    expect(native.iterations).toBe(maximum)
    for (const solver of [synchronous, asynchronous]) {
      expect(solver.solved).toBe(native.solved)
      expect(solver.failed).toBe(native.failed)
      expect(solver.error).toBe(native.error)
      expect(solver.iterations).toBe(native.iterations)
      expect(solver.state).toEqual(native.state)
      expect(solver.state.regionSegments).toEqual(native.state.regionSegments)
      expect(solver.getSelectiveReripStats()).toEqual(native.getSelectiveReripStats())
      const { incrementalPath, incrementalPathScope, ...nativeStats } = solver.stats
      expect(nativeStats).toEqual(native.stats)
      expect(solver.incrementalPath.repeatedQueries).toBeGreaterThan(0)
      expect(solver.incrementalPath.eligibleQueries).toBe(0)
      expect(solver.incrementalPath.chargedWork).toBe(0)
      expect(solver.incrementalPathScope.topologyEligible).toBe(0)
      expect(solver.incrementalPathScope.estimatedTransitions).toBeGreaterThan(solver.incrementalPathScope.maximumTransitions)
    }
  }
})

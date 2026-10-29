import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { IncrementalHopSearch } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalHopSearch"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("prepared retries invalidate all incoming region hops on owner, reservation, section and cost changes", (): void => {
  const drain = <T>(iterator: Generator<void, T>): T => {
    let next = iterator.next()
    while (!next.done) next = iterator.next()
    return next.value
  }
  class CheckedSolver extends IncrementalPreparedPortPointRoutingSolver {
    verifiedTransitions = 0
    completedPaths: number[][] = []
    override onPathFound(candidate: Candidate): void {
      const internals = this as unknown as {
        committing: boolean
        edges: Array<{ region: number; fromPort: number; toPort: number; terminal: boolean }>
        queries: Map<string, { search: IncrementalHopSearch }>
        transitionCost(edge: number): Generator<void, number[] | null>
      }
      if (internals.committing) {
        const route = this.state.currentRouteId!, start = this.getRouteStartPortId(route)
        const key = `${route}/${this.state.currentRouteNetId}/${start}/${this.getStartingNextRegionId(route, start)}/${this.state.goalPortId}`
        const search = internals.queries.get(key)!.search
        const dependencyVisits = this.incrementalPath.dependencyVisits
        for (let edge = 0; edge < internals.edges.length; edge++) {
          const expected = drain(internals.transitionCost(edge))!
          const actual = Array.from(search.costs.subarray(edge * 4, edge * 4 + 4))
          expect(actual).toEqual(expected)
          if (Number.isFinite(actual[0])) {
            const e = internals.edges[edge]!, to = e.terminal ? this.state.goalPortId : e.toPort
            const native = this.computeG({ portId: e.fromPort, nextRegionId: e.region, g: 0.37, h: 0, f: 0.37 }, to)
            expect(0.37 + actual[0]! + actual[1]! + actual[2]! + actual[3]!).toBe(native)
          }
          this.verifiedTransitions++
        }
        this.incrementalPath.dependencyVisits = dependencyVisits
        const path: number[] = []
        for (let at: Candidate | undefined = candidate; at; at = at.prevCandidate) path.push(at.portId)
        this.completedPaths.push(path.reverse())
      }
      super.onPathFound(candidate)
    }
  }
  const input = createIncrementalPathToy()
  const solver = new CheckedSolver(input.topology, input.problem, { MAX_ITERATIONS: 100_000, STATIC_REACHABILITY_PRECHECK: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false })
  const restart = (): void => {
    solver.resetRoutingStateForRerip(); solver.solved = false; solver.failed = false; solver.error = null
  }
  solver.solve(); expect(solver.solved).toBe(true); expect(solver.incrementalPath.activated).toBe(0)
  restart(); solver.solve(); expect(solver.solved).toBe(true)
  restart(); solver.problem.regionNetId[1] = 99; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 2, 4, 5])
  restart(); solver.problem.regionNetId[1] = -1; solver.state.portAssignment[2] = 99; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 1, 3, 5])
  restart(); solver.problem.portSectionMask[1] = 0; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 2, 4, 5])
  restart(); solver.problem.portSectionMask[1] = 1; solver.problemSetup.portEndpointReservationNetId[2] = 99; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 1, 3, 5])
  restart(); solver.problemSetup.portEndpointReservationNetId[2] = -1; solver.problem.portPenalty![1] = 3; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 2, 4, 5])
  restart(); solver.problem.portPenalty![1] = 0; solver.state.regionCongestionCost[1] = 4; solver.solve()
  expect(solver.solved).toBe(true); expect(solver.completedPaths.at(-1)).toEqual([0, 2, 4, 5])
  restart(); solver.DISTANCE_TO_COST = 0.07; solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.verifiedTransitions).toBeGreaterThan(100)
  expect(solver.incrementalPath.changedTransitions).toBeGreaterThan(0)
  expect(solver.incrementalPath.repairs).toBeGreaterThan(0)
  expect(solver.iterations).toBeGreaterThanOrEqual(solver.incrementalPath.chargedWork)
})

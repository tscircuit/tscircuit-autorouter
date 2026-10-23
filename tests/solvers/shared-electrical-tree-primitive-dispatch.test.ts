import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import { sharedElectricalTreeClearanceFixture } from "../fixtures/sharedElectricalTreeClearanceFixture"
import type { DrcEvaluator } from "high-density-repair03/lib"

test("only explicit shared-tree projection dispatches the graph kernel while the ordinary native path remains exact", (): void => {
  const { srj, routes, connections } = sharedElectricalTreeClearanceFixture()
  const drcEvaluator: DrcEvaluator = () => {
    // Force initialization only; this fixture inspects constructor dispatch,
    // and compares the actual ordinary child to an identical native oracle.
    return { errors: [{ type: "pcb_trace_error", message: "dispatch fixture" }], errorsWithCenters: [] }
  }
  const generic = new Pipeline9ClearanceProjectionSolver({ originalSrj: srj, routes, drcEvaluator })
  generic.step()
  expect(generic.activeSubSolver!.constructor).toBe(RelaxTraceClearanceSolver)
  const native = generic.activeSubSolver as RelaxTraceClearanceSolver
  const oracle = new RelaxTraceClearanceSolver(structuredClone(native.input))
  native.solve()
  oracle.solve()
  expect(native.getOutput()).toEqual(oracle.getOutput())
  expect(native.stats).toEqual(oracle.stats)
  expect(native.iterations).toBe(oracle.iterations)
  expect(native.MAX_ITERATIONS).toBe(oracle.MAX_ITERATIONS)
  const graph = new Pipeline9ClearanceProjectionSolver({ originalSrj: srj, routes, drcEvaluator, sharedTreeConnections: connections, subdivideSegments: true })
  graph.step()
  expect(graph.activeSubSolver!.constructor).toBe(SharedElectricalTreeClearanceSolver)
  expect(graph.activeSubSolver).not.toBeInstanceOf(RelaxTraceClearanceSolver)
  const child = graph.activeSubSolver as SharedElectricalTreeClearanceSolver
  expect(child.input.segmentIdentityByRoute.length).toBe(child.input.routes.length)
  child.solve()
  expect(child.stats.treePrimitiveMergedSourceReferences).toBeGreaterThan(0)
})

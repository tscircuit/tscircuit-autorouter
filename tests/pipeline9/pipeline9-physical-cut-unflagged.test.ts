import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { installPhysicalCutReservationGuard } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/pipeline9PhysicalCutResources"
import { createPhysicalCutTinyProblem } from "../fixtures/createPhysicalCutTinyProblem"

test("resource hook is idempotent and unflagged topology retains native reservation behavior", () => {
  const { topology, problem } = createPhysicalCutTinyProblem()
  const predicate = TinyHyperGraphSolver.prototype.isPortReservedForDifferentNet
  installPhysicalCutReservationGuard()
  installPhysicalCutReservationGuard()
  expect(TinyHyperGraphSolver.prototype.isPortReservedForDifferentNet).toBe(predicate)
  const plain = { ...topology, portMetadata: [{}, {}, {}, {}] }
  const solver = new TinyHyperGraphSolver(plain, problem)
  solver.state.currentRouteNetId = 10
  solver.state.portAssignment[0] = 20
  expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
  // Native endpoint reservation still rejects another net at route endpoint 2.
  expect(solver.isPortReservedForDifferentNet(2)).toBe(true)
  solver.state.currentRouteNetId = 0
  expect(solver.isPortReservedForDifferentNet(2)).toBe(false)
})

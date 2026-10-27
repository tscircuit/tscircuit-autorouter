import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments as OriginalSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("general incidence retains native routing without preparing a two-region table", async (): Promise<void> => {
  const input = createPreparedRoutingFixture()
  input.topology.incidentPortRegion[2]!.push(2)
  input.topology.regionIncidentPorts[2]!.push(2)
  const original = new OriginalSolver(input.topology, input.problem, input.options)
  original.solve()
  const prepared = new PreparedPortPointRoutingSolver(input.topology, input.problem, input.options)
  await prepared.solveAsync({executeAsync: async () => { throw new Error("Unsupported geometry must not dispatch preparation") }})
  expect(original.solved).toBe(true)
  expect(prepared.solved).toBe(true)
  expect(prepared.state.regionSegments).toEqual(original.state.regionSegments)
  expect(prepared.iterations).toBe(original.iterations)
})

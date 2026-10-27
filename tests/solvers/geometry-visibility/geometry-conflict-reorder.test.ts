import { expect, test } from "bun:test"
import { GeometryAutoroutingPipelineSolver } from "lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("global visibility search reconsiders copper that seals a future terminal", async () => {
  const input: SimpleRouteJson = await Bun.file(new URL("../../../node_modules/dataset-srj18/samples/sample001.json", import.meta.url)).json()
  input.connections = input.connections.slice(0, 8)
  const solver = new GeometryAutoroutingPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.conflictReorders).toBeGreaterThan(0)
  expect(solver.stats.replayedBranches).toBeGreaterThan(0)
  expect(solver.stats.acceptedBranches).toBe(8)
  expect(solver.stats.noRouteStates).toBeGreaterThan(0)
  expect(solver.getOutputSimpleRouteJson().connections).toEqual(input.connections)
})

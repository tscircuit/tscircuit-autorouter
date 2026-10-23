import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { negotiationInput } from "../fixtures/repair04StepFixtures"

test("default negotiation retains real search state across moved and reweighted spans", (): void => {
  const input = structuredClone({ ...negotiationInput, isLocked: undefined })
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  const routes = [
    { ...input.routes[0]!, route: [{ x: -1.8, y: 0, z: 0 }, { x: 1.8, y: 0, z: 0 }] },
    { ...input.routes[1]!, route: [{ x: 0, y: -1.8, z: 0 }, { x: 0, y: 1.8, z: 0 }] },
  ]
  const solver = new NegotiateTraceClearanceSolver({
    ...input,
    srj: { ...input.srj, bounds, obstacles: [] },
    bounds,
    routes,
    dirtyRouteIndices: [0, 1],
    isLocked: (): boolean => true,
    maxPathSearchNodes: 1_000_000,
    maxPathSearchCalls: 8,
    pathGridSizeScale: 4,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.persistentQueries).toBeGreaterThan(1)
  expect(solver.stats.persistentReusedQueries).toBeGreaterThan(0)
  expect(solver.stats.persistentReusedLabels).toBeGreaterThan(0)
  expect(solver.stats.persistentInvalidatedEdges).toBeGreaterThan(0)
  expect(solver.stats.persistentChangedEdges).toBeGreaterThan(0)
  expect(solver.stats.pathSearchNodes).toBeLessThanOrEqual(1_000_000)
  expect(solver.stats.persistentWorkUnits).toBeGreaterThan(solver.stats.persistentNodesPopped)
  const output = solver.getOutput()
  for (let index = 0; index < output.routes.length; index++) {
    expect(output.routes[index]!.route[0]).toMatchObject(routes[index]!.route[0]!)
    expect(output.routes[index]!.route.at(-1)).toMatchObject(routes[index]!.route.at(-1)!)
  }
})

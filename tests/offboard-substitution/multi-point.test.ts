import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import multiPointSrjData from "./srj/multi-point.srj.json"

/**
 * Tests how the substitution logic applies to a multi-point on-board net.
 *
 * Test Setup:
 * - On-board requirement: A three-point net (A, B, C).
 * - Off-board connection: B -> B'
 * - B' is positioned to be a more optimal connection point from both A and C
 *   than the original point B.
 *
 * Expected Outcome:
 * The solver should first generate a Minimum Spanning Tree (MST) for the
 * (A, B, C) net, resulting in two edges (e.g., A-B and B-C). It should then
 * optimize each edge independently. Both edges should be rerouted to the
 * more optimal B', resulting in two final traces: A -> B' and C -> B'.
 */
test("multi-point on-board net", async (): Promise<void> => {
  const srj = multiPointSrjData as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const newConnections = solver.srjWithPointPairs!.connections
  expect(newConnections).toHaveLength(2)
  const connectionsAsPointIdPairs = newConnections.map((c) =>
    c.pointsToConnect.map((p) => p.pointId).sort(),
  )
  expect(connectionsAsPointIdPairs).toContainEqual(["A", "B_prime"].sort())
  expect(connectionsAsPointIdPairs).toContainEqual(["C", "B_prime"].sort())

  // This unobstructed net should not need vias or layer changes.
  for (const trace of solver.getOutputSimplifiedPcbTraces()) {
    const staysOnTop = trace.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    )
    expect(staysOnTop).toBeTrue()
  }

  await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

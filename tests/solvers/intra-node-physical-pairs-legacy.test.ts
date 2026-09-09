import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

type ConnectionTask = IntraNodeRouteSolver["unsolvedConnections"][number]

test("legacy intra-node grouping remains unchanged without physical context or nonempty explicit pairs", (): void => {
  for (const domain of [
    "no-context-pairs",
    "context-no-pairs",
    "context-empty-pairs",
    "no-context-no-pairs",
  ] as const) {
    const { node, params } = createIntraNodePhysicalPairProblem()
    if (domain.startsWith("no-context")) {
      delete params.physicalClearanceContext
    }
    if (domain.endsWith("no-pairs")) {
      delete node.portPointsInPairs
    } else if (domain === "context-empty-pairs") {
      node.portPointsInPairs = []
    }
    const before = structuredClone(node)
    const expectedPoints = node.portPoints.map(
      ({ x, y, z }): { x: number; y: number; z: number } => ({ x, y, z }),
    )
    const solver = new IntraNodeRouteSolver(params)
    expect(solver.totalConnections).toBe(1)
    expect(solver.MAX_ITERATIONS).toBe(1_000)
    expect(solver.unsolvedConnections).toEqual([
      {
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        points: expectedPoints,
      },
    ])
    solver.step()
    expect(solver.solvedRoutes).toEqual([])
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.unsolvedConnections).toEqual(
      expectedPoints.slice(1).map(
        (point): ConnectionTask => ({
          connectionName: "paired-net",
          rootConnectionName: "paired-root",
          points: [expectedPoints[0]!, point],
        }),
      ),
    )
    expect(node).toEqual(before)
  }
})

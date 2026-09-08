import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

test("physical intra-node tasks retain two same-name planar pairs without inventing a via", (): void => {
  const { node, pairs, params } = createIntraNodePhysicalPairProblem()
  const before = structuredClone(node)
  const solver = new IntraNodeRouteSolver(params)
  expect(solver.totalConnections).toBe(2)
  expect(solver.MAX_ITERATIONS).toBe(1_000)
  expect(solver.unsolvedConnections).toEqual([
    {
      connectionName: "paired-net",
      rootConnectionName: "paired-root",
      points: pairs[0],
    },
    {
      connectionName: "paired-net",
      rootConnectionName: "paired-root",
      points: pairs[1],
    },
  ])
  expect(solver.unsolvedConnections[0]!.points[0]).not.toBe(
    node.portPointsInPairs![0]![0],
  )

  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  for (const pair of pairs) {
    const route = solver.solvedRoutes.find(
      (candidate): boolean => candidate.route[0]!.z === pair[0].z,
    )
    expect(route).toBeDefined()
    expect(route!.connectionName).toBe("paired-net")
    expect(route!.rootConnectionName).toBe("paired-root")
    expect(route!.route[0]).toMatchObject({
      x: pair[0].x,
      y: pair[0].y,
      z: pair[0].z,
    })
    expect(route!.route.at(-1)).toMatchObject({
      x: pair[1].x,
      y: pair[1].y,
      z: pair[1].z,
    })
    expect(route!.route.every((point): boolean => point.z === pair[0].z)).toBe(
      true,
    )
    expect(route!.vias).toEqual([])
    expect(route!.traceThickness).toBe(0.15)
    expect(route!.viaDiameter).toBe(0.3)
  }
  expect(node).toEqual(before)
})

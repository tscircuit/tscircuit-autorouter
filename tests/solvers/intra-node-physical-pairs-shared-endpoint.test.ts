import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortPoint } from "lib/types/high-density-types"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

type ConnectionPoints =
  IntraNodeRouteSolver["unsolvedConnections"][number]["points"]

test("physical pair coverage allows an explicitly shared endpoint without flattening its branches", (): void => {
  const { node, pairs, params } = createIntraNodePhysicalPairProblem()
  const firstPair = pairs[0]!
  const thirdPort: PortPoint = {
    x: 1,
    y: 1,
    z: 0,
    connectionName: "paired-net",
    rootConnectionName: "paired-root",
    portPointId: "top-c",
    pcb_port_id: "pcb-top-c",
  }
  node.portPoints = structuredClone([...firstPair, thirdPort])
  node.portPointsInPairs = [
    structuredClone(firstPair),
    [{ ...firstPair[1] }, { ...thirdPort }],
  ]
  const before = structuredClone(node)
  const solver = new IntraNodeRouteSolver(params)
  expect(solver.totalConnections).toBe(2)
  expect(
    solver.unsolvedConnections.map((task): ConnectionPoints => task.points),
  ).toEqual(node.portPointsInPairs)
  expect(solver.unsolvedConnections[0]!.points[1]).toEqual(
    solver.unsolvedConnections[1]!.points[0],
  )
  expect(solver.unsolvedConnections[0]!.points[1]).not.toBe(
    solver.unsolvedConnections[1]!.points[0],
  )
  expect(node).toEqual(before)
})

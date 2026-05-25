import { expect, test } from "bun:test"
import { FixedTopologyHighDensityIntraNodeSolver } from "../../lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import input01 from "../../fixtures/features/via-high-density/via-high-density01-input.json" with {
  type: "json",
}

test("FixedTopologyHighDensityIntraNodeSolver fails when any port point is bottom layer (z=1)", () => {
  const inputNode = structuredClone(input01.nodeWithPortPoints as any)
  const { portPoints: inputPortPoints, ...node } = inputNode
  const nodeWithPortPoints = {
    ...node,
    portPointsInPairs: createPortPointPairsFromPortPoints(inputPortPoints),
  }
  nodeWithPortPoints.portPointsInPairs[0]![0].z = 1

  const solver = new FixedTopologyHighDensityIntraNodeSolver({
    nodeWithPortPoints,
    colorMap: input01.colorMap,
    traceWidth: input01.traceWidth,
  })

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(String(solver.error)).toContain("only supports top-layer (z=0)")

  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(String(solver.error)).toContain("only supports top-layer (z=0)")
  expect(solver.solvedRoutes.length).toBe(0)
})

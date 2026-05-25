import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
test("HighDensitySolver draws an origin guide to failed nodes", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cn_fail",
        center: { x: 12, y: -7 },
        width: 1.2,
        height: 1.4,
        availableZ: [0, 1],
        portPointsInPairs: createPortPointPairsFromPortPoints([
          { x: 11.4, y: -7.7, z: 0, connectionName: "A" },
          { x: 12.6, y: -6.3, z: 0, connectionName: "A" },
        ]),
      },
    ],
  })
  solver.failed = true
  solver.nodeSolveMetadataById.set("cn_fail", {
    node: {
      capacityMeshNodeId: "cn_fail",
      center: { x: 12, y: -7 },
      width: 1.2,
      height: 1.4,
      availableZ: [0, 1],
      portPointsInPairs: createPortPointPairsFromPortPoints([
        { x: 11.4, y: -7.7, z: 0, connectionName: "A" },
        { x: 12.6, y: -6.3, z: 0, connectionName: "A" },
      ]),
    },
    status: "failed",
    solverType: "HyperSingleIntraNodeSolver",
    iterations: 123,
    routeCount: 0,
    nodePf: 0.2,
    error: "ran out of candidates",
  })
  const visualization = solver.visualize()
  const guideLines =
    visualization.lines?.filter(
      (line) =>
        line.layer === "hd_failed_node_guides" &&
        line.label?.includes("node: cn_fail"),
    ) ?? []
  expect(guideLines).toHaveLength(1)
  expect(guideLines[0]?.strokeColor).toBe("red")
  expect(guideLines[0]?.strokeDash).toBe("8, 6")
  expect(guideLines[0]?.strokeWidth).toBe(0.05)
  const failedNodeLabel = guideLines[0]?.label ?? ""
  expect(failedNodeLabel).toContain("portPoints: 2")
  expect(failedNodeLabel).not.toContain("connections:")
  expect(guideLines[0]?.points).toEqual([
    { x: 0, y: 0 },
    { x: 12, y: -7 },
  ])
})

import { expect, test } from "bun:test"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"

test.skip("pipeline5 visualizes failed high-density nodes with a visible red marker", () => {
  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cmn_fail",
        center: { x: 10, y: 20 },
        width: 1.2,
        height: 1.4,
        availableZ: [0, 1],
        portPoints: [
          { x: 9.6, y: 19.7, z: 0, connectionName: "A" },
          { x: 10.4, y: 20.3, z: 0, connectionName: "A" },
          { x: 9.6, y: 20.3, z: 1, connectionName: "B" },
          { x: 10.4, y: 19.7, z: 1, connectionName: "B" },
        ],
      },
    ],
  })

  solver.nodeSolveMetadataById.set("cmn_fail", {
    node: {
      capacityMeshNodeId: "cmn_fail",
      center: { x: 10, y: 20 },
      width: 1.2,
      height: 1.4,
      availableZ: [0, 1],
      portPoints: [
        { x: 9.6, y: 19.7, z: 0, connectionName: "A" },
        { x: 10.4, y: 20.3, z: 0, connectionName: "A" },
        { x: 9.6, y: 20.3, z: 1, connectionName: "B" },
        { x: 10.4, y: 19.7, z: 1, connectionName: "B" },
      ],
    },
    status: "failed",
    resolution: "failed",
    solverType: "HyperSingleIntraNodeSolver",
    supervisorType: "HyperSingleIntraNodeSolver",
    iterations: 123,
    pairCount: 2,
    routeCount: 0,
    nodePf: 0.18,
    remoteAttempt: {
      attempted: false,
    },
    error: "local fallback failed",
  })

  const visualization = solver.visualize()
  const failedRects =
    visualization.rects?.filter((rect) =>
      rect.label?.includes("node: cmn_fail"),
    ) ?? []
  const failedCrossLines =
    visualization.lines?.filter(
      (line) =>
        line.layer === "hd_node_markers" &&
        line.label?.includes("node: cmn_fail"),
    ) ?? []
  const failedGuideLines =
    visualization.lines?.filter(
      (line) =>
        line.layer === "hd_failed_node_guides" &&
        line.label?.includes("node: cmn_fail"),
    ) ?? []
  const failedCircles =
    visualization.circles?.filter(
      (circle) =>
        circle.layer === "hd_node_markers" &&
        circle.label?.includes("node: cmn_fail"),
    ) ?? []
  const failedBoundaryLines =
    visualization.lines?.filter(
      (line) =>
        line.layer === "hd_node_boundaries" &&
        line.label?.includes("node: cmn_fail"),
    ) ?? []
  const failedPoints =
    visualization.points?.filter((point) =>
      point.label?.includes("node: cmn_fail"),
    ) ?? []

  expect(failedRects).toHaveLength(1)
  expect(failedRects[0]?.fill).toBe("rgba(255, 0, 0, 0.3)")
  expect(failedRects[0]?.stroke).toBe("red")
  expect(failedRects[0]?.width).toBe(1.2)
  expect(failedRects[0]?.height).toBe(1.4)
  expect(failedCircles).toHaveLength(1)
  expect(failedCircles[0]?.stroke).toBe("red")
  expect(failedGuideLines).toHaveLength(1)
  expect(failedGuideLines[0]?.strokeColor).toBe("red")
  expect(failedGuideLines[0]?.strokeDash).toBe("8, 6")
  expect(failedGuideLines[0]?.strokeWidth).toBe(0.05)
  expect(failedGuideLines[0]?.points).toEqual([
    { x: 0, y: 0 },
    { x: 10, y: 20 },
  ])
  expect(failedCrossLines).toHaveLength(2)
  expect(failedCrossLines.every((line) => line.strokeColor === "red")).toBe(
    true,
  )
  expect(failedCrossLines.every((line) => line.strokeWidth === 0.16)).toBe(true)
  expect(failedBoundaryLines).toHaveLength(4)
  expect(failedBoundaryLines.every((line) => line.strokeColor === "red")).toBe(
    true,
  )
  expect(failedBoundaryLines.every((line) => line.strokeWidth === 0.08)).toBe(
    true,
  )
  expect(failedPoints).toHaveLength(0)
})

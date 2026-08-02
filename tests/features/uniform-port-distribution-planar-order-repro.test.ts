import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import {
  sample4PlanarPortOrderInputNodes,
  sample4PlanarPortOrderNodes,
} from "./fixtures/uniform-port-distribution-planar-order.fixture"

const colorByRoot: Record<string, string> = {
  source_trace_175: "rgb(220, 38, 38)",
  source_trace_169: "rgb(37, 99, 235)",
}

test("visualizes sample 4 duplicated-port ordering on a single-layer node", () => {
  const distributionSolver = new UniformPortDistributionSolver({
    nodeWithPortPoints: structuredClone(sample4PlanarPortOrderNodes),
    inputNodesWithPortPoints: structuredClone(
      sample4PlanarPortOrderInputNodes,
    ),
    obstacles: [],
    minTraceWidth: 0.1,
    traceClearance: 0.1,
  })
  distributionSolver.solve()

  const routedNode = distributionSolver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === "sample4-left-node")!
  const singleLayerSolver =
    new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver({
      nodeWithPortPoints: routedNode,
      traceWidth: 0.1,
      traceClearance: 0.1,
      viaDiameter: 0.3,
    })
  singleLayerSolver.solve()

  const pairGuides = (routedNode.portPointsInPairs ?? []).map(
    ([start, end]) => ({
      points: [start, end],
      strokeColor: colorByRoot[start.rootConnectionName!]!.replace(
        "rgb(",
        "rgba(",
      ).replace(")", ", 0.45)"),
      strokeWidth: 0.015,
      strokeDash: [0.04, 0.025],
      label: `${start.rootConnectionName}: requested connection pair (not copper)`,
    }),
  )
  const solvedRoutes = singleLayerSolver.solvedRoutes.map((route) => ({
    points: route.route,
    strokeColor: colorByRoot[route.rootConnectionName!]!,
    strokeWidth: route.traceThickness,
    label: `${route.rootConnectionName}: routed copper`,
  }))
  const graphics: GraphicsObject = {
    rects: [
      {
        center: routedNode.center,
        width: routedNode.width,
        height: routedNode.height,
        fill: "rgba(107, 114, 128, 0.06)",
        stroke: "rgb(107, 114, 128)",
        label: "single-layer capacity node (z5)",
      },
    ],
    lines: [
      {
        points: [
          { x: 0.82, y: -0.185 },
          { x: 0.82, y: 0.185 },
        ],
        strokeColor: "rgb(15, 118, 110)",
        strokeWidth: 0.012,
        label: "0.37 mm shared boundary",
      },
      ...pairGuides,
      ...solvedRoutes,
    ],
    points: routedNode.portPoints.map((point) => ({
      x: point.x,
      y: point.y,
      color: colorByRoot[point.rootConnectionName!]!,
      label: `${point.rootConnectionName} port`,
    })),
    texts: [
      {
        x: -0.8,
        y: 0.34,
        text: singleLayerSolver.solved
          ? "PASS: shared-edge port order is planar"
          : "FAIL: shared-edge port identities force a crossing",
        fontSize: 0.055,
      },
      {
        x: -0.8,
        y: 0.27,
        text: singleLayerSolver.solved
          ? "Dashed = requested pairs; solid = routed copper"
          : "Dashed = requested pairs; no legal single-layer copper exists",
        fontSize: 0.035,
        color: "rgb(75, 85, 99)",
      },
      {
        x: -0.8,
        y: -0.27,
        text: "Red = source_trace_175    Blue = source_trace_169    Teal = shared boundary",
        fontSize: 0.028,
        color: "rgb(75, 85, 99)",
      },
    ],
  }

  expect(getSvgFromGraphicsObject(graphics)).toMatchSvgSnapshot(
    import.meta.path,
  )
})

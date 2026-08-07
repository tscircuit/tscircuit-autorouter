import "bun-match-svg"
import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const capacityMeshNodes: CapacityMeshNode[] = [
  {
    capacityMeshNodeId: "component-left",
    center: { x: -1, y: 0 },
    width: 2,
    height: 3,
    layer: "top",
    availableZ: [0, 1],
    _isComponentTopologyNode: true,
  },
  {
    capacityMeshNodeId: "component-right",
    center: { x: 1, y: 0 },
    width: 2,
    height: 3,
    layer: "top",
    availableZ: [0, 1],
    _isComponentTopologyNode: true,
  },
]

const portPoints: SegmentPortPoint[] = [-0.8, -0.4, 0, 0.4, 0.8].map(
  (y, index) => ({
    segmentPortPointId: `component-boundary-port-${index}`,
    x: 0,
    y,
    availableZ: [0],
    nodeIds: ["component-left", "component-right"],
    edgeId: "component-boundary",
    connectionName: null,
    distToCentermostPortOnZ: Math.abs(y),
    cramped: true,
  }),
)

const sharedEdgeSegment: SharedEdgeSegment = {
  edgeId: "component-boundary",
  nodeIds: ["component-left", "component-right"],
  start: { x: 0, y: -1.5 },
  end: { x: 0, y: 1.5 },
  availableZ: [0],
  portPoints,
}

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles: [],
  connections: [],
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
}

const visualizeBoundary = (
  displayedPortPoints: SegmentPortPoint[],
): GraphicsObject => ({
  rects: capacityMeshNodes.map((node) => ({
    center: node.center,
    width: node.width - 0.08,
    height: node.height,
    fill: "#e2e8f0",
    stroke: "#64748b",
    label: node.capacityMeshNodeId,
  })),
  lines: [
    {
      points: [sharedEdgeSegment.start, sharedEdgeSegment.end],
      strokeColor: "#94a3b8",
      strokeDash: "4 4",
      label: sharedEdgeSegment.edgeId,
    },
  ],
  points: displayedPortPoints.map((portPoint) => ({
    x: portPoint.x,
    y: portPoint.y,
    color: "#2563eb",
    label: `${portPoint.segmentPortPointId}\nreal cramped port-point`,
  })),
  texts: [
    {
      x: 0,
      y: 1.8,
      text: `${displayedPortPoints.length} real port-point${displayedPortPoints.length === 1 ? "" : "s"}`,
      anchorSide: "bottom_center",
      fontSize: 0.18,
      color: "#0f172a",
    },
  ],
})

test("shows component boundary port pruning", async () => {
  const solverInput = {
    capacityMeshNodes,
    sharedEdgeSegments: [sharedEdgeSegment],
    simpleRouteJson,
    numberOfCrampedPortPointsToKeep: 0,
    preserveNonNecessaryMultilayerPorts: false,
  }
  const solver = new MultiTargetNecessaryCrampedPortPointSolver(solverInput)

  solver.solve()

  const outputPortPoints = solver.getOutput()[0]!.portPoints
  expect(solver.solved).toBe(true)
  expect(outputPortPoints.length).toBeGreaterThan(0)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Input: 5 cramped component ports",
          step: 0,
          iteration: 0,
          graphics: visualizeBoundary(portPoints),
        },
        {
          name:
            outputPortPoints.length === portPoints.length
              ? "Issue: all 5 unused ports remain"
              : `Result: ${outputPortPoints.length} connectivity port remains`,
          step: 1,
          iteration: solver.iterations,
          graphics: visualizeBoundary(outputPortPoints),
        },
      ],
      columns: 2,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

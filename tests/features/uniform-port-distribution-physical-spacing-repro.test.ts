import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

const sharedPorts = [
  {
    portPointId: "sample4-edge-port-0",
    connectionName: "source_trace_175",
    rootConnectionName: "source_trace_175",
    x: 0,
    y: -0.1,
    z: 5,
  },
  {
    portPointId: "sample4-edge-port-1",
    connectionName: "source_trace_169",
    rootConnectionName: "source_trace_169",
    x: 0,
    y: 0.1,
    z: 5,
  },
]

test("visualizes sample 4 uniform distribution on a 0.37 mm edge", () => {
  const nodeWithPortPoints = [
    {
      capacityMeshNodeId: "left",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 0.37,
      availableZ: [5],
      portPoints: structuredClone(sharedPorts),
      portPointsInPairs: [],
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 0.5, y: 0 },
      width: 1,
      height: 0.37,
      availableZ: [5],
      portPoints: structuredClone(sharedPorts),
      portPointsInPairs: [],
    },
  ]
  const inputNodesWithPortPoints = nodeWithPortPoints.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((point) => ({
      ...point,
      connectionNodeIds: ["left", "right"] as [string, string],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints,
    inputNodesWithPortPoints,
    obstacles: [],
    minTraceWidth: 0.1,
    traceClearance: 0.1,
  } as any)

  solver.solve()

  const ports = solver
    .getOutput()[0]!
    .portPoints.toSorted((a, b) => a.y - b.y)
  const actualSpacing = ports[1]!.y - ports[0]!.y
  const requiredSpacing = 0.2
  const spacingShortfall = requiredSpacing - actualSpacing
  const spacingPasses = spacingShortfall <= 1e-9
  const graphics: GraphicsObject = {
    lines: [
      {
        points: [
          { x: 0, y: -0.185 },
          { x: 0, y: 0.185 },
        ],
        strokeColor: "rgb(37, 99, 235)",
        strokeWidth: 0.008,
        label: "0.37 mm shared node boundary",
      },
      ...ports.map((port, index) => ({
        points: [
          { x: -0.16, y: port.y },
          { x: 0.16, y: port.y },
        ],
        strokeColor: "rgb(220, 38, 38)",
        strokeWidth: 0.1,
        label: `port ${index + 1}: 0.1 mm trace`,
      })),
      {
        points: [
          { x: 0.21, y: ports[0]!.y },
          { x: 0.21, y: ports[1]!.y },
        ],
        strokeColor: spacingPasses
          ? "rgb(22, 163, 74)"
          : "rgb(220, 38, 38)",
        strokeWidth: 0.008,
        label: `${actualSpacing.toFixed(3)} mm actual center spacing`,
      },
      ...ports.flatMap((port) => [
        {
          points: [
            { x: 0.19, y: port.y },
            { x: 0.23, y: port.y },
          ],
          strokeColor: spacingPasses
            ? "rgb(22, 163, 74)"
            : "rgb(220, 38, 38)",
          strokeWidth: 0.008,
        },
      ]),
    ],
    points: ports.map((port, index) => ({
      x: port.x,
      y: port.y,
      color: "rgb(20, 20, 20)",
      label: `port ${index + 1}`,
    })),
    rects: [
      {
        center: { x: -0.15, y: 0 },
        width: 0.3,
        height: 0.37,
        fill: "rgba(59, 130, 246, 0.06)",
        stroke: "rgb(59, 130, 246)",
        label: "left capacity node",
      },
      {
        center: { x: 0.15, y: 0 },
        width: 0.3,
        height: 0.37,
        fill: "rgba(59, 130, 246, 0.06)",
        stroke: "rgb(59, 130, 246)",
        label: "right capacity node",
      },
    ],
    circles: [],
    texts: [
      {
        x: -0.29,
        y: 0.245,
        text: `${spacingPasses ? "PASS" : "FAIL"}: port centers are ${actualSpacing.toFixed(3)} mm apart`,
        fontSize: 0.025,
      },
      {
        x: -0.29,
        y: 0.21,
        text: `Required: ${requiredSpacing.toFixed(3)} mm (0.100 mm trace + 0.100 mm clearance)`,
        fontSize: 0.019,
        color: "rgb(75, 85, 99)",
      },
    ],
  }
  const svg = getSvgFromGraphicsObject(graphics)

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
} from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("shows the native iCEPi DDR crossing beside BALL_AA11", async (): Promise<void> => {
  const { inputSrj } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/icepi-retained-vias/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson }
  // Actual ce39469 interface from tscircuit3133, before high-density routing.
  const port = {
    portPointId: "ce39469_pp0_z0_cramped::0",
    connectionName: "source_trace_44",
    rootConnectionName: "source_trace_44",
    x: 18.72,
    y: -1.188333333333348,
    z: 0,
  }
  const nodes: Array<NodeWithPortPoints & { availableZ: number[] }> = [
    {
      capacityMeshNodeId: "topology_merge_10685",
      center: { x: 18.599999999999994, y: -1.2750000000000175 },
      width: 0.240000000000002,
      height: 0.4099999999999997,
      availableZ: [0],
      portPoints: [{ ...port }],
    },
    {
      capacityMeshNodeId: "cmn_1__sub_2_0",
      center: { x: 24.665, y: 5.366666666666653 },
      width: 11.890000000000002,
      height: 13.346666666666662,
      availableZ: [0, 1, 2, 3],
      portPoints: [{ ...port }],
    },
  ]
  const ownerNodeIds: [string, string] = [
    nodes[0]!.capacityMeshNodeId,
    nodes[1]!.capacityMeshNodeId,
  ]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((point) => ({
      ...point,
      portPointId: point.portPointId!,
      connectionNodeIds: ownerNodeIds,
      distToCentermostPortOnZ: 0,
      cramped: true,
    })),
  }))
  const params = {
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: inputSrj.obstacles,
    layerCount: inputSrj.layerCount,
    useLayerAwareGeometry: true,
    minTraceWidth: inputSrj.minTraceWidth!,
    srj: inputSrj,
    connMap: getConnectivityMapFromSimpleRouteJson(inputSrj),
  }
  const solver = new UniformPortDistributionSolver(params)
  solver.solve()
  const points = solver.getOutput().map((node) => node.portPoints[0]!)
  expect(solver.solved).toBeTrue()
  expect(points).toHaveLength(2)
  expect(points[0]).toEqual(points[1])
  expect(points[0]!.portPointId).toBe(port.portPointId)
  expect(points[0]!.x).toBe(port.x)
  expect(points[0]!.y).toBeGreaterThanOrEqual(-1.3066666666666782)
  expect(points[0]!.y).toBeLessThanOrEqual(-1.0700000000000176)
  expect(inputSrj.minTraceToPadEdgeClearance).toBe(0.1)

  const padObstacle = inputSrj.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_23",
  )!
  const pad = createPcbPadElements({
    ...inputSrj,
    connections: [],
    obstacles: [padObstacle],
  }).find((element) => element.type === "pcb_smtpad")!
  // The searched A13 endpoint is unchanged when this artificial anchor moves.
  const searchedPoint = { x: 18.881999999999998, y: -1.1446666666666783 }
  const gap = getTraceObstacleClearance(
    points[0]!,
    searchedPoint,
    inputSrj.minTraceWidth!,
    compileTraceClearanceObstacle(pad, 0),
  ).gap
  const graphics: GraphicsObject = {
    title: `iCEPi DDR source_trace_44: pad clearance ${gap.toFixed(4)} mm (required 0.1 mm)`,
    circles: [
      {
        center: padObstacle.center,
        radius: padObstacle.width / 2,
        fill: "#fca5a5",
        stroke: "#b91c1c",
      },
      {
        center: padObstacle.center,
        radius: padObstacle.width / 2 + inputSrj.minTraceWidth! / 2 + 0.1,
        fill: "transparent",
        stroke: "#fecaca",
      },
    ],
    lines: [
      {
        points: [
          { x: 18.72, y: -1.3066666666666782 },
          { x: 18.72, y: -1.0700000000000176 },
        ],
        strokeColor: "#64748b",
        strokeWidth: 0.008,
      },
      {
        // Clip the actual next horizontal run, which continues to x=19.8791.
        points: [points[0]!, searchedPoint, { x: 19.1, y: searchedPoint.y }],
        strokeColor: "#0f766e",
        strokeWidth: inputSrj.minTraceWidth!,
      },
    ],
    points: [{ ...points[0]!, color: "#0f766e", label: "shared crossing" }],
  }
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
    .replaceAll(
      'stroke-linejoin="round"',
      'stroke-linejoin="round" stroke-linecap="round"',
    )
    .replace(
      "</svg>",
      `<g><rect x="8" y="8" width="624" height="60" fill="white"/><text x="20" y="30" font-family="Arial, sans-serif" font-size="17">Native iCEPi DDR crossing beside BALL_AA11</text><text x="20" y="54" font-family="Arial, sans-serif" font-size="17">Clearance: ${gap.toFixed(4)} mm; required: 0.1000 mm</text></g></svg>`,
    )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})

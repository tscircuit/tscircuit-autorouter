import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { existingPlaneVias } from "tests/fixtures/existing-plane-vias"

test("existing through-vias are reused when planning access to GND", async (): Promise<void> => {
  const input = structuredClone(existingPlaneVias)
  const escapeSolver = new EscapeViaLocationSolver(input)
  escapeSolver.solve()
  expect(escapeSolver.solved).toBeTrue()
  const output = escapeSolver.getOutputSimpleRouteJson()
  const pairs = new NetToPointPairsSolver2_OffBoardConnection(
    output,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(output),
  )
  pairs.solve()
  expect(pairs.solved).toBeTrue()
  expect(escapeSolver.createdEscapeVias).toHaveLength(0)
  expect(pairs.newConnections).toHaveLength(0)
  expect(input).toEqual(existingPlaneVias)

  const plane = input.obstacles[0]!
  const vias = input.obstacles.slice(1)
  const graphics: GraphicsObject = {
    rects: [{ ...plane, fill: "rgba(77,124,15,0.10)", stroke: "#4d7c0f" }],
    circles: [
      ...vias.map((via) => ({
        center: via.center,
        radius: via.width / 2,
        fill: "#2563eb",
        stroke: "#1e40af",
      })),
      ...escapeSolver.createdEscapeVias.map((via) => ({
        center: { x: via.x, y: via.y },
        radius: input.minViaPadDiameter! / 2,
        fill: "#fed7aa",
        stroke: "#c2410c",
      })),
    ],
    lines: pairs.newConnections.map((connection) => ({
      points: connection.pointsToConnect,
      strokeWidth: input.minTraceWidth,
      strokeColor: "#db2777",
      strokeDash: [4, 3],
    })),
    texts: [
      {
        x: 0,
        y: 3.15,
        text: "Existing vias already reach the planned ground plane",
        fontSize: 0.22,
      },
      {
        x: 0,
        y: 2.72,
        text: `ACTUAL: ${escapeSolver.createdEscapeVias.length} new via plans; ${pairs.newConnections.length} extra trace requests`,
        fontSize: 0.19,
      },
      {
        x: 0,
        y: 2.36,
        text: "EXPECTED: reuse the two existing vias; no new routing",
        fontSize: 0.17,
      },
      {
        x: 0,
        y: 1.65,
        text: "Green: planned inner1 GND plane (XY projection)",
        fontSize: 0.16,
      },
      ...input.connections[0]!.pointsToConnect.map((point) => ({
        x: point.x,
        y: -0.55,
        text: `${point.pointId}: existing via`,
        fontSize: 0.17,
      })),
      {
        x: 0,
        y: -1.15,
        text: "A and B are on inner3; both barrels span all six layers",
        fontSize: 0.15,
      },
      {
        x: 0,
        y: -1.55,
        text: "Already possible: A -> via -> inner1 GND -> via -> B",
        fontSize: 0.15,
      },
      {
        x: 0,
        y: -2.4,
        text: "Blue = existing via   |   Orange = requested new via",
        fontSize: 0.16,
      },
      {
        x: 0,
        y: -2.78,
        text: "Pink dashes = requested connections, not routed copper",
        fontSize: 0.16,
      },
      {
        x: 0,
        y: -3.16,
        text: "Native plane-access and point-pair stages only; no saved routing",
        fontSize: 0.14,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})

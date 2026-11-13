import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("STM32 ground escape vias are not recognized as access to the planned plane", async (): Promise<void> => {
  const { inputSrj, cpuGroundPointIds, cpuPads } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/stm32-existing-plane-vias.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    inputSrj: SimpleRouteJson
    cpuGroundPointIds: string[]
    cpuPads: { x: number; y: number; radius: number }[]
  }
  // Run the complete captured motherboard input, not a cropped routing problem.
  const solver = new EscapeViaLocationSolver(inputSrj)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = solver.getOutputSimpleRouteJson()
  const map = getInitiallyConnectedMapFromSimpleRouteJson(output)
  const firstGroundGroup = map.getNetConnectedToId(cpuGroundPointIds[0]!)
  const recognizedPointIds = new Set(
    cpuGroundPointIds.filter(
      (id) =>
        firstGroundGroup !== undefined &&
        map.getNetConnectedToId(id) === firstGroundGroup,
    ),
  )
  const recognized = recognizedPointIds.size
  expect(cpuGroundPointIds).toHaveLength(104)
  expect(cpuPads).toHaveLength(354)
  // Reproduction: all 104 through-vias exist, but no group links their endpoints.
  expect(recognized).toBe(0)

  const groundIds = new Set(cpuGroundPointIds)
  const groundPoints = inputSrj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) => groundIds.has(point.pointId!)),
  )
  const existingVias = groundPoints.map((point) => {
    const via = inputSrj.obstacles.find(
      (obstacle) =>
        obstacle.shape === "circle" &&
        obstacle.layers.includes("inner1") &&
        obstacle.layers.includes("inner3") &&
        obstacle.connectedTo.includes(point.pointId!) &&
        Math.hypot(obstacle.center.x - point.x, obstacle.center.y - point.y) <
          1e-6,
    )
    expect(via).toBeDefined()
    return via!
  })
  const cpuNewVias = solver.createdEscapeVias.filter((via) =>
    groundIds.has(via.sourcePointId!),
  )
  expect(cpuNewVias).toHaveLength(0)
  const plane = inputSrj.obstacles.find(
    (obstacle) => obstacle.isCopperPour && obstacle.layers.includes("inner1"),
  )!
  const graphics: GraphicsObject = {
    // Only the drawing is cropped. All 354 actual pads and 104 GND vias remain.
    rects: [{ ...plane, fill: "rgba(77,124,15,0.10)", stroke: "#4d7c0f" }],
    circles: [
      ...cpuPads.map((pad) => ({
        center: pad,
        radius: pad.radius,
        fill: "#d1d5db",
        stroke: "none",
      })),
      // These outer rings visualize solver bookkeeping, not extra copper.
      ...existingVias.map((via, index) => ({
        center: via.center,
        radius: via.width / 2 + 0.08,
        fill: recognizedPointIds.has(groundPoints[index]!.pointId!)
          ? "#15803d"
          : "#dc2626",
        stroke: "none",
      })),
      ...existingVias.map((via) => ({
        center: via.center,
        radius: via.width / 2,
        fill: "#2563eb",
        stroke: "none",
      })),
      ...cpuNewVias.map((via) => ({
        center: via,
        radius: inputSrj.minViaPadDiameter! / 2,
        fill: "#f97316",
        stroke: "none",
      })),
    ],
    texts: [
      {
        x: 0,
        y: 33.5,
        text: "Real motherboard: STM32MP157D ground escapes",
        fontSize: 0.65,
      },
      {
        x: 0,
        y: 32.3,
        text: `${recognized} / 104 recognized through the ground plane`,
        fontSize: 0.75,
      },
      {
        x: 0,
        y: 31.2,
        text: "Same pads and vias; the change is recognition of existing connections",
        fontSize: 0.43,
      },
      {
        x: 0,
        y: 8.9,
        text: "Gray = all 354 STM32 pads   |   Blue = 104 existing GND through-vias",
        fontSize: 0.43,
      },
      {
        x: 0,
        y: 7.8,
        text: "STATUS RINGS: red = unrecognized; green = recognized (not copper)",
        fontSize: 0.43,
      },
      {
        x: 0,
        y: 6.7,
        text: `New via plans: ${cpuNewVias.length}. Zero before and after on this dense STM32 capture.`,
        fontSize: 0.4,
      },
      {
        x: 0,
        y: 5.6,
        text: "Complete board input; STM32 view only; plane-access stage only",
        fontSize: 0.4,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})

import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("full motherboard reuses existing vias when planning plane connections", async (): Promise<void> => {
  const { inputSrj, preloadedTraces } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/motherboard-existing-plane-vias.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; preloadedTraces: SimplifiedPcbTrace[] }
  // Complete compact motherboard input captured through core 52c97e2 after native dogbone.
  // The 351 dogbone traces are already obstacles in inputSrj; preloadedTraces
  // only supplies their original copper geometry for display, as in the Glider repro.
  const inputHash = createHash("sha256")
    .update(JSON.stringify(inputSrj))
    .digest("hex")
  expect(inputSrj.bounds).toEqual({
    minX: -77,
    maxX: 77,
    minY: -48.5,
    maxY: 48.5,
  })
  expect(inputSrj.connections).toHaveLength(443)
  expect(inputSrj.obstacles).toHaveLength(6449)
  expect(preloadedTraces).toHaveLength(351)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  // Exercise the normal pipeline up to connection planning, before global routing.
  while (
    !solver.netToPointPairsSolver?.solved &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }
  expect(solver.failed).toBeFalse()
  expect(solver.escapeViaLocationSolver?.solved).toBeTrue()
  expect(solver.netToPointPairsSolver?.solved).toBeTrue()
  expect(
    createHash("sha256").update(JSON.stringify(inputSrj)).digest("hex"),
  ).toBe(inputHash)

  const escapeSolver = solver.escapeViaLocationSolver!
  const pairs =
    solver.netToPointPairsSolver!.getNewSimpleRouteJson().connections
  // Net names in this capture: source_net_0 = GND; source_net_7 = DDR1V35.
  const ground = inputSrj.connections.find(
    (connection) => connection.name === "source_net_0",
  )!
  const groundPairs = pairs.filter((connection) =>
    connection.__rootConnectionNames?.includes(ground.name),
  )
  const ddrPowerPairs = pairs.filter((connection) =>
    connection.__rootConnectionNames?.includes("source_net_7"),
  )
  const groundIds = new Set(
    ground.pointsToConnect.map((point) => point.pointId!),
  )
  const groundViaPlans = escapeSolver.createdEscapeVias.filter((via) =>
    groundIds.has(via.sourcePointId!),
  )
  const existingGroundEndpoints = ground.pointsToConnect.filter((point) =>
    point.pointId!.startsWith("pcb_breakout_point_"),
  )
  const map = getInitiallyConnectedMapFromSimpleRouteJson(
    escapeSolver.getOutputSimpleRouteJson(),
  )
  const firstGroundGroup = map.getNetConnectedToId(
    existingGroundEndpoints[0]!.pointId!,
  )
  const recognized = existingGroundEndpoints.filter(
    (point) =>
      firstGroundGroup !== undefined &&
      map.getNetConnectedToId(point.pointId!) === firstGroundGroup,
  ).length
  expect(existingGroundEndpoints).toHaveLength(125)
  // Record the current failure; the stacked fix updates these and the same SVG.
  expect(recognized).toBe(0)
  expect(pairs).toHaveLength(1888)
  expect(groundPairs).toHaveLength(657)
  expect(ddrPowerPairs).toHaveLength(58)
  expect(escapeSolver.createdEscapeVias).toHaveLength(535)
  expect(groundViaPlans).toHaveLength(516)

  const board = convertSrjToGraphicsObject({
    ...inputSrj,
    traces: preloadedTraces,
  })
  const graphics: GraphicsObject = {
    rects: [
      {
        center: { x: 0, y: 0 },
        width: inputSrj.bounds.maxX - inputSrj.bounds.minX,
        height: inputSrj.bounds.maxY - inputSrj.bounds.minY,
        fill: "none",
        stroke: "#475569",
      },
      ...board.rects.map((rect) => ({
        ...rect,
        label: undefined,
        fill: "#cbd5e1",
        stroke: "none",
      })),
    ],
    lines: [
      ...board.lines.map((line) => ({
        ...line,
        label: undefined,
        strokeColor: "#2563eb",
      })),
      ...groundPairs.map((connection) => ({
        points: connection.pointsToConnect,
        strokeColor: "#db2777",
        strokeWidth: inputSrj.minTraceWidth,
        strokeDash: [0.5, 0.5],
      })),
    ],
    circles: [
      ...board.circles,
      ...groundViaPlans.map((via) => ({
        center: via,
        radius: inputSrj.minViaPadDiameter! / 2,
        fill: "#ea580c",
        stroke: "none",
      })),
    ],
    texts: [
      { x: 0, y: 63, text: "4-MOTOR USB-C CONTROL MOTHERBOARD", fontSize: 3 },
      {
        x: 0,
        y: 58,
        text: "Complete 154 x 97 mm board / 6 copper layers / components on top",
        fontSize: 1.8,
      },
      { x: -63, y: 51, text: "PD INPUT", fontSize: 1.5 },
      { x: -39, y: 51, text: "PC DATA", fontSize: 1.5 },
      { x: -17, y: 51, text: "CAMERA", fontSize: 1.5 },
      { x: 9, y: 47, text: "DDR3L", fontSize: 1.5 },
      { x: 9, y: 7, text: "STM32MP157D", fontSize: 1.6 },
      { x: -27, y: -52, text: "M1-M4 POWER", fontSize: 1.8 },
      { x: 45, y: -52, text: "M1-M4 USB DATA", fontSize: 1.8 },
      {
        x: 0,
        y: -60,
        text: `Existing GND via endpoints recognized: ${recognized} / ${existingGroundEndpoints.length} (104 STM32 + 21 DDR)`,
        fontSize: 2.1,
      },
      {
        x: 0,
        y: -65,
        text: `Connection requests: ${pairs.length} total / ${groundPairs.length} GND / ${ddrPowerPairs.length} DDR power`,
        fontSize: 2.1,
      },
      {
        x: 0,
        y: -70,
        text: `New GND via plans: ${groundViaPlans.length}. Existing copper and placement are unchanged.`,
        fontSize: 1.8,
      },
      {
        x: 0,
        y: -76,
        text: "PINK = GND requests, not copper / BLUE = existing dogbone copper / ORANGE = new GND via plans",
        fontSize: 1.6,
      },
      {
        x: 0,
        y: -81,
        text: "Native plane access + connection planning only; global routing has not run in this test",
        fontSize: 1.6,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1600,
      svgHeight: 1400,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1, tolerance: 0 })
})

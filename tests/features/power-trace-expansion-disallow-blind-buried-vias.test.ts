import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import type { SimplifiedPcbTrace } from "lib/types"

test("power expansion materializes only newly added through vias", () => {
  const wire = (x: number, y: number) => ({
    route_type: "wire" as const,
    x,
    y,
    width: 0.15,
    layer: "top",
  })
  const callerPartialTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "caller-partial",
    connection_name: "OTHER",
    route: [
      {
        route_type: "via",
        x: -4,
        y: -3,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.6,
      },
    ],
  }
  const powerTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power",
    connection_name: "POWER",
    route: [wire(-5, 0), wire(5, 0)],
  }
  const input: Pipeline7PowerTraceExpansionInput = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.15,
    nominalTraceWidth: 1,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.6,
    bounds: { minX: -6, maxX: 6, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "top-layer-wall",
        center: { x: 0, y: 0 },
        width: 1.8,
        height: 8.5,
        layers: ["top"],
        connectedTo: [],
      },
      ...[-5, 5].flatMap((x) => [
        {
          type: "rect" as const,
          obstacleId: `power-pad-${x}`,
          center: { x, y: 0 },
          width: 0.35,
          height: 0.5,
          layers: ["top"],
          connectedTo: ["POWER"],
        },
        {
          type: "rect" as const,
          obstacleId: `upper-neighbor-${x}`,
          center: { x, y: 0.7 },
          width: 0.6,
          height: 0.2,
          layers: ["top"],
          connectedTo: ["OTHER"],
        },
        {
          type: "rect" as const,
          obstacleId: `lower-neighbor-${x}`,
          center: { x, y: -0.7 },
          width: 0.6,
          height: 0.2,
          layers: ["top"],
          connectedTo: ["OTHER"],
        },
      ]),
    ],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 1,
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
      { name: "OTHER", pointsToConnect: [] },
    ],
    traces: [powerTrace, callerPartialTrace],
    fixedTraces: [],
    authoredInputTraces: [callerPartialTrace],
  }
  const solver = new PowerTraceExpansionSolver(input, {
    allowNewVias: true,
    onlyConnectionNames: ["POWER"],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.powerTraceExpanderSolver.insertedViaCount).toBeGreaterThan(0)
  const output = solver.getOutput()
  const generatedPowerVias = output
    .find((trace) => trace.pcb_trace_id === "power")!
    .route.filter((routePoint) => routePoint.route_type === "via")
  expect(generatedPowerVias.length).toBeGreaterThan(0)
  expect(
    generatedPowerVias.every(
      (via) => via.from_layer === "top" && via.to_layer === "bottom",
    ),
  ).toBe(true)
  expect(
    output
      .find((trace) => trace.pcb_trace_id === "caller-partial")!
      .route.find((routePoint) => routePoint.route_type === "via"),
  ).toMatchObject({ from_layer: "top", to_layer: "inner1" })
})

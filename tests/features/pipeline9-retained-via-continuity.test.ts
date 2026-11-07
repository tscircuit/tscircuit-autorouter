import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("retained SRJ vias connect earlier traces across copper layers without duplicating routed vias", (): void => {
  const vias: Obstacle[] = [-1, 1].map((x, index) => ({
    type: "rect",
    shape: "circle",
    center: { x, y: 0 },
    width: 0.6,
    height: 0.6,
    layers: ["top", "inner1", "inner2", "bottom"],
    connectedTo: ["power", "pcb_port_0", "pcb_port_1", `fixed_via_${index}`],
    circuitJsonMetadata: { pcb_via_id: `fixed_via_${index}` },
  }))
  const traces: SimplifiedPcbTrace[] = [-3, 3].map((x, i) => ({
    type: "pcb_trace",
    pcb_trace_id: `branch_${i}`,
    connection_name: "power",
    connectsTo: [`pcb_port_${i}`],
    route: [
      { route_type: "wire", x, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: x / 3, y: 0, layer: "top", width: 0.2 },
    ],
  }))
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    connections: [],
    traces: [
      ...traces,
      {
        type: "pcb_trace",
        pcb_trace_id: "bottom_bridge",
        connection_name: "power",
        connectsTo: ["pcb_port_0", "pcb_port_1"],
        route: [
          { route_type: "wire", x: -1, y: 0, layer: "bottom", width: 0.2 },
          { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.2 },
        ],
      },
    ],
    obstacles: [
      ...vias,
      ...[-3, 3].map(
        (x, i): Obstacle => ({
          type: "rect",
          center: { x, y: 0 },
          width: 0.6,
          height: 0.6,
          layers: ["top"],
          connectedTo: ["power", `pcb_port_${i}`],
          circuitJsonMetadata: {
            pcb_port_id: `pcb_port_${i}`,
            pcb_smtpad_id: `pad_${i}`,
          },
        }),
      ),
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 2,
        layers: ["inner1"],
        connectedTo: ["power", "pcb_port_0", "pcb_port_1"],
        isCopperPour: true,
      },
    ],
  }
  const evaluate = (
    srj: SimpleRouteJson,
  ): ReturnType<ReturnType<typeof createPipeline9AutoroutingDrcEvaluator>> =>
    createPipeline9AutoroutingDrcEvaluator({
      inputSrj: srj,
      srjWithPointPairs: srj,
      includeBoardClearance: true,
    })([])
  const result = evaluate(input)
  expect(result.errors).toEqual([])
  expect(result.circuitJson.filter((e) => e.type === "pcb_via")).toEqual([])
  for (const change of ["missing", "foreign", "wrong-layer"] as const) {
    const broken = structuredClone(input)
    if (change === "missing") broken.obstacles.splice(0, 1)
    else if (change === "foreign") broken.obstacles[0]!.connectedTo = ["other"]
    else broken.obstacles[0]!.layers = ["top"]
    expect(
      evaluate(broken).errors.some((e) =>
        String(e.pcb_trace_error_id).startsWith("disconnected_endpoint_"),
      ),
    ).toBe(true)
  }
})

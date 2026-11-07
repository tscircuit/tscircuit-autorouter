import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"

test("preloaded traces retain terminal net aliases after their original phase is removed", (): void => {
  for (const sameNet of [false, true]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
      connections: [],
      obstacles: [-3, 3, 0].map((x, index) => ({
        type: "rect",
        center: { x, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [
          `pcb_smtpad_${index}`,
          `pcb_port_${index}`,
          index < 2 || sameNet ? "supply" : "foreign",
        ],
        circuitJsonMetadata: { pcb_port_id: `pcb_port_${index}` },
      })),
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "completed_phase",
          connection_name: "bypass",
          connectsTo: ["pcb_port_0", "pcb_port_1"],
          route: [
            { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.1 },
            { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
          ],
        },
      ],
    }
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: srj,
      srjWithPointPairs: srj,
      drcOptions: { traceClearance: 0.1 },
    })
    const { errors } = evaluate([])
    if (sameNet) expect(errors).toHaveLength(0)
    else
      expect(
        errors.some((error) => error.pcb_trace_id === "completed_phase"),
      ).toBe(true)
  }
})

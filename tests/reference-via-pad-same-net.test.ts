import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("equivalent named aliases exempt own SMT and plated copper without exempting foreign vias", (): void => {
  for (const plated of [false, true]) {
    const srj: SimpleRouteJson = {
      layerCount: 8,
      minTraceWidth: 0.1,
      minViaPadDiameter: 0.3,
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      connections: [
        {
          name: "root_mst0",
          __rootConnectionNames: ["root"],
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_own" },
            { x: 3, y: 0, layer: "bottom", pcb_port_id: "pcb_port_end" },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          layers: plated ? ["top", "bottom"] : ["top"],
          connectedTo: [
            plated ? "pcb_plated_hole_own" : "pcb_smtpad_own",
            "pcb_port_own",
            "root",
          ],
        },
      ],
    }
    const trace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "owned_trace",
      connection_name: "root_mst0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          layer: "top",
          width: 0.1,
          start_pcb_port_id: "pcb_port_own",
        },
        {
          route_type: "via",
          x: 0.1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        {
          route_type: "wire",
          x: 3,
          y: 0,
          layer: "bottom",
          width: 0.1,
          end_pcb_port_id: "pcb_port_end",
        },
      ],
    }
    const own = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [trace],
      drcOptions: { includeTraceContinuity: false },
    })
    expect(
      own.errors.filter(
        (error) => error.type === "pcb_pad_pad_clearance_error",
      ),
    ).toHaveLength(0)
    const foreign = {
      ...trace,
      pcb_trace_id: "foreign_trace",
      connection_name: "foreign",
      connectsTo: ["foreign"],
    }
    foreign.route = trace.route.map((point) => {
      if (point.route_type !== "wire") return point
      const { start_pcb_port_id, end_pcb_port_id, ...wire } = point
      return { ...wire, x: point.x === 0 ? -3 : point.x }
    })
    const result = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [foreign],
      drcOptions: { includeTraceContinuity: false },
    })
    expect(
      result.errors.filter(
        (error) => error.type === "pcb_pad_pad_clearance_error",
      ),
    ).toHaveLength(1)
  }
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { assertBusAllowedLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assertBusAllowedLayers"

test("accepts permitted bus wires with a through via", () => {
  expect(() =>
    assertBusAllowedLayers({
      buses: [
        {
          busId: "control",
          connectionNames: ["member"],
          allowedLayers: ["top", "bottom"],
        },
      ],
      connMap: new ConnectivityMap({}),
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "routed-trace",
          connection_name: "member",
          route: [
            { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
            { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" },
            {
              route_type: "via",
              x: 1,
              y: 0,
              from_layer: "top",
              to_layer: "bottom",
              layers: ["top", "inner1", "inner2", "bottom"],
            },
            { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "bottom" },
            { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "bottom" },
          ],
        },
      ],
    }),
  ).not.toThrow()
})

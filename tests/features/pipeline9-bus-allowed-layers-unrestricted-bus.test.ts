import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { assertBusAllowedLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assertBusAllowedLayers"

test("accepts inner-layer bus copper when no layers are restricted", () => {
  expect(() =>
    assertBusAllowedLayers({
      buses: [{ busId: "control", connectionNames: ["member"] }],
      connMap: new ConnectivityMap({}),
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "routed-trace",
          connection_name: "member",
          route: [
            { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "inner1" },
          ],
        },
      ],
    }),
  ).not.toThrow()
})

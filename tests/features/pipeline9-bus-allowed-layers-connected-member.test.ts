import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { assertBusAllowedLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assertBusAllowedLayers"

test("rejects a forbidden layer on a connected bus branch", () => {
  expect(() =>
    assertBusAllowedLayers({
      buses: [
        {
          busId: "control",
          connectionNames: ["member"],
          allowedLayers: ["top", "bottom"],
        },
      ],
      connMap: new ConnectivityMap({ control: ["member", "branch"] }),
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "routed-trace",
          connection_name: "branch",
          route: [
            { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "inner1" },
          ],
        },
      ],
    }),
  ).toThrow('Pipeline9 bus "control" routed on forbidden layer "inner1"')
})

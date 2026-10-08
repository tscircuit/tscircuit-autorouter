import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { assertBusAllowedLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assertBusAllowedLayers"

test("does not treat a shared name prefix as bus membership", () => {
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
          pcb_trace_id: "unrelated-trace",
          connection_name: "member_branch",
          route: [
            { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "inner1" },
          ],
        },
      ],
    }),
  ).not.toThrow()
})

import { expect, test } from "bun:test"
import { getUnroutableBgaTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getUnroutableBgaTerminalError"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getTrappedBgaTerminalFixture } from "tests/fixtures/getTrappedBgaTerminalFixture"

test("BGA feasibility leaves preloaded escapes and local connections intact", (): void => {
  const { srj, components } = getTrappedBgaTerminalFixture()
  srj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "escape",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.05, layer: "top" },
        { route_type: "wire", x: 0.8, y: 0.8, width: 0.05, layer: "top" },
      ],
    },
  ]
  expect(
    getUnroutableBgaTerminalError(
      srj,
      components,
      getConnectivityMapFromSimpleRouteJson(srj),
    ),
  ).toBeNull()

  // A connection contained in the pocket does not require escaping its ring.
  srj.traces = []
  srj.connections[0]!.pointsToConnect[1] = { x: 0.05, y: 0, layer: "top" }
  expect(
    getUnroutableBgaTerminalError(
      srj,
      components,
      getConnectivityMapFromSimpleRouteJson(srj),
    ),
  ).toBeNull()
})

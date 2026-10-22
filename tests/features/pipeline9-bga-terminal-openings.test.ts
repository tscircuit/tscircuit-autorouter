import { expect, test } from "bun:test"
import { getUnroutableBgaTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getUnroutableBgaTerminalError"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getTrappedBgaTerminalFixture } from "tests/fixtures/getTrappedBgaTerminalFixture"

test("BGA feasibility respects same-net, missing-pad, and multilayer escapes", (): void => {
  for (const opening of ["same-net", "missing-pad", "multilayer", "plated"]) {
    const { srj, components } = getTrappedBgaTerminalFixture()
    if (opening === "same-net") {
      srj.obstacles[5]!.connectedTo = ["signal-alias"]
      srj.connections[0]!.__rootConnectionNames = ["signal-alias"]
    } else if (opening === "missing-pad") {
      srj.obstacles.splice(5, 1)
    } else if (opening === "multilayer") {
      srj.obstacles[4]!.layers = ["top", "bottom"]
      srj.connections[0]!.pointsToConnect[0] = {
        x: 0,
        y: 0,
        layers: ["top", "bottom"],
        pcb_port_id: "center",
      }
    } else {
      srj.obstacles.push({
        type: "rect",
        center: { x: 0.05, y: 0 },
        width: 0.1,
        height: 0.1,
        layers: ["top", "bottom"],
        connectedTo: ["signal"],
      })
    }
    expect(
      getUnroutableBgaTerminalError(
        srj,
        components,
        getConnectivityMapFromSimpleRouteJson(srj),
      ),
    ).toBeNull()
  }
})

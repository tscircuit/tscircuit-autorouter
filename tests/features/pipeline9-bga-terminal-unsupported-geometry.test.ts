import { expect, test } from "bun:test"
import { getUnroutableBgaTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getUnroutableBgaTerminalError"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getTrappedBgaTerminalFixture } from "tests/fixtures/getTrappedBgaTerminalFixture"

test("BGA feasibility does not infer a closed pocket from unsupported geometry", (): void => {
  for (const geometry of ["circle", "rotation", "rectangle", "offset"]) {
    const { srj, components } = getTrappedBgaTerminalFixture()
    const neighbor = srj.obstacles[5]!
    if (geometry === "circle") neighbor.shape = "circle"
    if (geometry === "rotation") neighbor.ccwRotationDegrees = 45
    if (geometry === "rectangle") neighbor.height /= 2
    // Even offsets below the position-key precision must not pass validation.
    if (geometry === "offset") neighbor.center.y += 1e-7
    expect(
      getUnroutableBgaTerminalError(
        srj,
        components,
        getConnectivityMapFromSimpleRouteJson(srj),
      ),
    ).toBeNull()
  }
})

import { expect, test } from "bun:test"
import { getEnclosedTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getEnclosedTerminalError"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { createEnclosedTerminalFixture } from "../fixtures/pipeline9-enclosed-terminal-fixture"

test("enclosure validation leaves possible escapes and unsupported geometry to routing", (): void => {
  const variants: Array<(srj: SimpleRouteJson) => void> = [
    (srj): void => { srj.obstacles.pop() },
    (srj): void => { srj.minTraceToPadEdgeClearance = 0.01 },
    (srj): void => { srj.allowViaInPad = true },
    (srj): void => { srj.allowJumpers = true },
    (srj): void => { srj.minViaDiameter = 0.1 },
    (srj): void => { srj.obstacles[1]!.connectedTo.push("center_port") },
    (srj): void => { srj.obstacles[1]!.layers = ["bottom"] },
    (srj): void => { srj.obstacles[1]!.ccwRotationDegrees = 45 },
    (srj): void => { srj.obstacles[0]!.layers.push("bottom") },
    (srj): void => { srj.connections[0]!.pointsToConnect[1] = { x: 0.05, y: 0, layer: "top" } },
    (srj): void => {
      for (const obstacle of srj.obstacles.slice(1)) {
        obstacle.center.x *= 1.5
        obstacle.center.y *= 1.5
      }
    },
  ]
  for (const change of variants) {
    const srj = createEnclosedTerminalFixture()
    change(srj)
    expect(getEnclosedTerminalError(
      srj,
      getConnectivityMapFromSimpleRouteJson(srj),
      getViaDimensions(srj).padDiameter,
    )).toBeUndefined()
  }
})

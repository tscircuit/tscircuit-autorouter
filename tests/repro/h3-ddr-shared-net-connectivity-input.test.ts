import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import input from "../../fixtures/bug-reports/h3-ddr-shared-net-connectivity/input.srj.json" with {
  type: "json",
}

// Captured from our four-layer H3/DDR3 HDMI streaming-stick board after saved
// fanout: retain DQS0_P/N, their four escape traces, and four source pads.
// Geometry, point IDs, and Core's connectsTo metadata are preserved.
test("H3 DDR strobe input preserves the disconnected saved escape traces", () => {
  const srj: SimpleRouteJson = structuredClone(input)
  expect(srj.connections).toHaveLength(2)
  expect(srj.traces).toHaveLength(4)
  for (const connection of srj.connections) {
    expect(connection.pointsToConnect).toHaveLength(2)
    const [start, end] = connection.pointsToConnect
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(11)
    for (const point of connection.pointsToConnect) {
      const fragments = srj.traces!.filter((trace) =>
        trace.connectsTo?.includes(point.pointId!),
      )
      expect(fragments).toHaveLength(1)
      expect(fragments[0].connectsTo).toContain(connection.name)
      expect(fragments[0].route.at(-1)).toMatchObject({
        route_type: "wire",
        x: point.x,
        y: point.y,
        layer: "bottom",
      })
    }
  }
  expect(convertSrjToGraphicsObject(srj)).toMatchGraphicsSvg(import.meta.path)
})

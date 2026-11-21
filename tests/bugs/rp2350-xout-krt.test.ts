import { expect, test } from "bun:test"
import { doesSegmentIntersectRect } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import fixture from "../../fixtures/bug-reports/rp2350-xout-krt/input.srj.json"

test("KRT escapes the RP2350 XOUT pad between XIN and DVDD2", async (): Promise<void> => {
  const input = structuredClone(fixture) as SimpleRouteJson
  const solver = new KrtAutoroutingPipelineSolver(input)
  solver.solve()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const [trace] = traces
  const [connection] = input.connections
  expect(trace.connection_name).toBe(connection.name)
  const wires = trace.route.filter((p) => p.route_type === "wire")
  expect(wires.length).toBeGreaterThanOrEqual(2)
  expect(wires).toHaveLength(trace.route.length)
  for (const [i, point] of connection.pointsToConnect.entries()) {
    const pad = input.obstacles.find((p) => p.connectedTo.includes(point.pointId!))!
    const end = i === 0 ? wires[0] : wires[wires.length - 1]
    expect(Math.abs(end.x - pad.center.x)).toBeLessThan(pad.width / 2)
    expect(Math.abs(end.y - pad.center.y)).toBeLessThan(pad.height / 2)
  }
  for (const [i, wire] of wires.entries()) {
    expect(wire.layer).toBe("top")
    expect(wire.width).toBe(0.15)
    if (i === 0) continue
    for (const pad of input.obstacles.filter((p) => !p.connectedTo.includes(connection.name))) {
      const margin = wire.width / 2 + fixture.defaultObstacleMargin
      expect(doesSegmentIntersectRect(wires[i - 1], wire, {
        minX: pad.center.x - pad.width / 2 - margin,
        maxX: pad.center.x + pad.width / 2 + margin,
        minY: pad.center.y - pad.height / 2 - margin,
        maxY: pad.center.y + pad.height / 2 + margin,
      })).toBe(false)
    }
  }
  const graphics = convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson())
  graphics.points = []
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})

import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("rotated U52 middle pad cannot capture same-net neighboring terminals in its unrotated bounds", () => {
  const ys = [156.06009936, 155.42509936, 156.69509936]
  const ids = ["U52.7", "U52.8", "U52.6"]
  const obstacles: Obstacle[] = ys.map((y, index) => ({
    obstacleId: ids[index], componentId: "U52", type: "rect", layers: ["bottom"],
    center: { x: 83.75780048, y }, width: 0.3999992, height: 1.44999964,
    ccwRotationDegrees: 90, connectedTo: ids,
  }))
  // The actual middle pad occurs first and owns all3 same-net connection IDs.
  for (const allowViaInPad of [undefined, false, true]) {
    const srj: SimpleRouteJson = { layerCount: 8, minTraceWidth: 0.1, allowViaInPad,
      bounds: { minX: 80, maxX: 87, minY: 152, maxY: 160 }, obstacles: structuredClone(obstacles),
      connections: [{ name: "same-net", pointsToConnect: ys.map((y, index) => ({
        x: 83.75780048, y, layer: "bottom", pointId: ids[index], pcb_port_id: `pcb-${ids[index]}`,
      })) }] }
    const before = structuredClone(srj)
    const output = addApproximatingRectsToSrj(srj)
    expect(output.connections).toEqual(before.connections)
    expect(srj.connections).toEqual(before.connections)
    expect(output.obstacles).toHaveLength(3)
    for (const obstacle of output.obstacles) {
      expect(obstacle.width).toBe(1.44999964)
      expect(obstacle.height).toBe(0.3999992)
      expect(obstacle.connectedTo).toEqual(ids)
      expect(obstacle.layers).toEqual(["bottom"])
    }
  }
})

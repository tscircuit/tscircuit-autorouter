import { expect, test } from "bun:test"
import { getOctilinearKrtTerminalConnector } from "lib/testing/getOctilinearKrtTerminalConnector"
import type { SimplifiedPcbTrace } from "lib/types"

test("KRT terminal connectors stay inside every signed rounding box", (): void => {
  const coordinates = [-0.049, -0.03, -0.01, 0, 0.01, 0.03, 0.049]
  const gridPoint: Extract<
    SimplifiedPcbTrace["route"][number],
    { route_type: "wire" }
  > = { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" }
  for (const x of coordinates) {
    for (const y of coordinates) {
      const connector = getOctilinearKrtTerminalConnector({
        terminal: { x, y, layer: "top" },
        gridPoint,
      })
      expect(connector[0]).toMatchObject({ x, y, width: 0.2, layer: "top" })
      expect(connector.length).toBeLessThanOrEqual(2)
      const points = [...connector, gridPoint]
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(Math.min(x, 0) - 1e-12)
        expect(point.x).toBeLessThanOrEqual(Math.max(x, 0) + 1e-12)
        expect(point.y).toBeGreaterThanOrEqual(Math.min(y, 0) - 1e-12)
        expect(point.y).toBeLessThanOrEqual(Math.max(y, 0) + 1e-12)
        expect(point.width).toBe(0.2)
        expect(point.layer).toBe("top")
      }
      for (let index = 1; index < points.length; index++) {
        const dx = Math.abs(points[index].x - points[index - 1].x)
        const dy = Math.abs(points[index].y - points[index - 1].y)
        expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-12).toBe(true)
      }
    }
  }
})

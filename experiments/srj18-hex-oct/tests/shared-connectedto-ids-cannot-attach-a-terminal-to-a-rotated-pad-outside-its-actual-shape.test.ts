import { test, expect } from "bun:test"
import { GridRouter, type Obstacle } from "../src/gridRouter"
const bounds = { minX: -3, minY: -3, maxX: 3, maxY: 3 }
const terminal = { x: 0, y: 0, layer: "top", pointId: "portA" }
const pad = (layers: string[], center = { x: 0, y: 0 }) => ({ type: "rect", width: 1, height: 1, center, layers, connectedTo: ["net", "portA"] })
const makeRouter = (obstacles: Obstacle[]) => new GridRouter({ bounds, layerCount: 2, obstacles, connections: [{ name: "net", pointsToConnect: [terminal] }] }, { pitch: 0.2 })
test("shared connectedTo IDs cannot attach a terminal to a rotated pad outside its actual shape", () => {
  const r = makeRouter([pad(["top"]), { ...pad(["top", "bottom"], { x: 0.4, y: -0.4 }), width: 1, height: 0.1, ccwRotationDegrees: 45 }])
  expect(r.terminalLayers(terminal, r.union.find("net"))).toEqual([0])
})

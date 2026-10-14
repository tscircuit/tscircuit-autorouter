import { test, expect } from "bun:test"
import { GridRouter, type Obstacle } from "../src/gridRouter"
const bounds = { minX: -3, minY: -3, maxX: 3, maxY: 3 }
const terminal = { x: 0, y: 0, layer: "top", pointId: "portA" }
const pad = (layers: string[], center = { x: 0, y: 0 }) => ({
  type: "rect",
  width: 1,
  height: 1,
  center,
  layers,
  connectedTo: ["net", "portA"],
})
const makeRouter = (obstacles: Obstacle[]) =>
  new GridRouter(
    {
      bounds,
      layerCount: 2,
      obstacles,
      connections: [{ name: "net", pointsToConnect: [terminal] }],
    },
    { pitch: 0.2 },
  )
test("a physical multilayer pad containing the terminal does permit bottom access", () => {
  const r = makeRouter([pad(["top", "bottom"])])
  expect(r.terminalLayers(terminal, r.union.find("net"))).toEqual([0, 1])
})

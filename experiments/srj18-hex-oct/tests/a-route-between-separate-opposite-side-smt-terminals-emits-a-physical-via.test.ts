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
test("a route between separate opposite-side SMT terminals emits a physical via", () => {
  const input = {
    bounds,
    layerCount: 2,
    obstacles: [
      pad(["top"]),
      pad(["bottom"]),
      pad(["bottom"], { x: 1.5, y: 0 }),
    ],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          terminal,
          { x: 1.5, y: 0, layer: "bottom", pointId: "portB" },
        ],
      },
    ],
  }
  for (const grid of ["hex", "oct"] as const) {
    const r = new GridRouter(input, { grid, pitch: 0.2, timeLimit: 2 }).run()
    expect(r.experiment.completedConnectionNames).toEqual(["net"])
    expect(r.traces[0].route[0].layer).toBe("top")
    expect(r.traces[0].route.at(-1)!.layer).toBe("bottom")
    expect(r.traces[0].route.some((p) => p.route_type === "via")).toBe(true)
  }
})

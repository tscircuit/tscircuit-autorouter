import { expect, test } from "bun:test"
import { emptyBoard, makeRouter } from "./helpers/pruningHelpers"

test("certificates include concave board edges, inner-layer copper and the full via footprint", () => {
  for (const grid of ["hex", "oct"] as const) {
    const outline = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 12 },
      { x: 0, y: 12 },
    ]
    const r = makeRouter(grid, "regions", { ...emptyBoard, outline })
    expect(
      r.clearRegion({ minX: 2, minY: 2, maxX: 6, maxY: 6 }, 0.1, "net"),
    ).toBe(false)
    expect(
      r.clearRegion({ minX: 1, minY: 1, maxX: 2, maxY: 2 }, 0.1, "net"),
    ).toBe(true)
    const inner = makeRouter(grid, "regions", {
      ...emptyBoard,
      layerCount: 4,
      obstacles: [
        {
          type: "oval",
          center: { x: 5, y: 5 },
          width: 0.2,
          height: 0.2,
          layers: ["inner1"],
        },
      ],
    })
    expect(
      inner.clearRegion({ minX: 3, minY: 3, maxX: 6, maxY: 6 }, 0.1, "net"),
    ).toBe(false)
    expect(
      inner.clearRegion({ minX: 3, minY: 3, maxX: 4.8, maxY: 4.8 }, 0.1, "net"),
    ).toBe(false)
  }
})

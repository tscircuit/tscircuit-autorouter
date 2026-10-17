import { expect, test } from "bun:test"
import { emptyBoard, makeRouter, searchCost } from "./helpers/pruningHelpers"

test("a layer-specific wall still permits a necessary short top-bottom-top bridge", () => {
  for (const grid of ["hex", "oct"] as const) {
    const input = {
      ...emptyBoard,
      obstacles: [
        {
          type: "rect",
          center: { x: 4.1, y: 6 },
          width: 0.15,
          height: 12,
          layers: ["top"],
        },
      ],
    }
    const r = makeRouter(grid, "regions", input),
      control = makeRouter(grid, "off", input),
      [si, sj] = r.grid.nearest(3.4, 5),
      [gi, gj] = r.grid.nearest(4.8, 5),
      start = r.state(si, sj, 0),
      goal = r.state(gi, gj, 0)
    expect(searchCost(r, start, goal)).toEqual(searchCost(control, start, goal))
    expect(searchCost(r, start, goal).vias).toBe(2)
  }
})

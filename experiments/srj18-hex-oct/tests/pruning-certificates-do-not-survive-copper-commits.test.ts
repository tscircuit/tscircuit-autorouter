import { expect, test } from "bun:test"
import { makeRouter, searchCost } from "./helpers/pruningHelpers"

test("committing foreign copper invalidates clear-area certificates before the next search", () => {
  for (const grid of ["hex", "oct"] as const) {
    const r = makeRouter(grid, "regions"), control = makeRouter(grid, "off"),
      [si, sj] = r.grid.nearest(3, 5), [gi, gj] = r.grid.nearest(7, 5),
      start = r.state(si, sj, 0), goal = r.state(gi, gj, 0)
    expect(searchCost(r, start, goal).vias).toBe(0)
    expect(r.searchStats.certifiedRegions).toBeGreaterThan(0)
    const copper = { net: "foreign", a: { x: 5, y: 0 }, b: { x: 5, y: 12 }, radius: 0.1, layers: [0] }
    r.addCopper(copper); control.addCopper(copper)
    expect(searchCost(r, start, goal)).toEqual(searchCost(control, start, goal))
    expect(searchCost(r, start, goal).vias).toBe(2)
  }
})

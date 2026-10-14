import { expect, test } from "bun:test"
import { makeRouter, searchCost } from "./helpers/pruningHelpers"

test("starts and targets inside certified patches retain layer access on both grids", () => {
  for (const grid of ["hex", "oct"] as const) {
    const r = makeRouter(grid, "regions"),
      start = r.state(5, 5, 0),
      goal = r.state(6, 6, 1)
    const expected = searchCost(makeRouter(grid, "off"), start, goal)
    expect(searchCost(r, start, goal)).toEqual(expected)
    expect(expected.vias).toBe(1)
    expect(r.searchStats.certifiedRegions).toBeGreaterThan(0)
  }
})

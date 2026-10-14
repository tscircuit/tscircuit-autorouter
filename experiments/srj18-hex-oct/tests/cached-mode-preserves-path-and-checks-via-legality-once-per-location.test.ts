import { expect, test } from "bun:test"
import { emptyBoard, makeRouter } from "./helpers/pruningHelpers"

test("cached mode preserves the exact path and evaluates each physical via location at most once", () => {
  for (const grid of ["hex", "oct"] as const) {
    const input = { ...emptyBoard, layerCount: 4 }, cached = makeRouter(grid, "cached", input), control = makeRouter(grid, "off", input),
      start = cached.state(5, 5, 0), goal = cached.state(10, 8, 3), calls = new Set<string>(), original = cached.viaLegal.bind(cached)
    cached.viaLegal = (p, net) => {
      const key = `${p.x},${p.y}`
      expect(calls.has(key)).toBe(false); calls.add(key)
      return original(p, net)
    }
    const run = (r: typeof cached) => r.search([{ id: start, distance: 0 }], [{ id: goal, distance: 0 }], cached.point(goal), 0.1, "net")
    expect(run(cached)?.ids).toEqual(run(control)?.ids)
    expect(cached.searchStats.viaLegalityChecks).toBeLessThan(control.searchStats.viaLegalityChecks)
  }
})

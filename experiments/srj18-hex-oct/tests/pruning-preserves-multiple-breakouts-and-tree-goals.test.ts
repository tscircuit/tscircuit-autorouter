import { expect, test } from "bun:test"
import { emptyBoard, makeRouter, dijkstraCost } from "./helpers/pruningHelpers"

test("all breakout candidates and physical tree goals remain gateways with their endpoint costs", () => {
  for (const grid of ["hex", "oct"] as const) {
    const r = makeRouter(grid, "regions", { ...emptyBoard, layerCount: 4 }),
      starts = [
        { id: r.state(5, 5, 0), distance: 0.9 },
        { id: r.state(6, 5, 1), distance: 0.1 },
      ],
      goals = [
        { id: r.state(7, 6, 3), distance: 0.3 },
        { id: r.state(6, 7, 2), distance: 0.2 },
      ]
    const expected = Math.min(
        ...starts.flatMap((start) =>
          goals.map(
            (goal) =>
              start.distance +
              dijkstraCost(r, start.id, goal.id) +
              goal.distance,
          ),
        ),
      ),
      result = r.search(starts, goals, r.point(goals[0].id), 0.1, "net")
    if (!result || !result.end)
      throw new Error("Expected a complete path with an explicit target")
    let cost = result.start.distance + result.end.distance
    for (let k = 1; k < result.ids.length; k++) {
      const a = result.ids[k - 1],
        b = result.ids[k],
        p = r.point(a),
        q = r.point(b)
      cost +=
        r.layer(a) === r.layer(b)
          ? Math.hypot(p.x - q.x, p.y - q.y)
          : r.config.viaPenalty
    }
    expect(cost).toBeCloseTo(expected, 8)
  }
})

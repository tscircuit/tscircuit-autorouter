import { expect, test } from "bun:test"
import { GridRouter, type Dataset } from "../src/gridRouter"
import { emptyBoard, searchCost, dijkstraCost } from "./helpers/pruningHelpers"

test("hex/oct pruning preserves independent Dijkstra cost with layer obstacles and through-via restrictions", () => {
  let pruned = 0
  for (const grid of ["hex", "oct"] as const)
    for (const layers of [2, 4])
      for (const viaPenalty of [0, 0.5, 2])
        for (let seed = 0; seed < 5; seed++) {
          const names = layers === 2 ? ["top", "bottom"] : ["top", "inner1", "inner2", "bottom"]
          const input: Dataset = { ...emptyBoard, layerCount: layers, obstacles: seed === 0 ? [] : [{
            type: seed % 2 ? "rect" : "oval", center: { x: 5.5, y: 5.5 },
            width: 0.3 + seed * 0.1, height: 2.7, ccwRotationDegrees: seed * 17,
            layers: [names[seed % layers]],
          }] }
          const controls = ["off", "cached", "regions"] as const
          const routers = controls.map(layerPruning => new GridRouter(input, { grid, layerPruning, pitch: 1, viaPenalty, timeLimit: 60 }))
          const r = routers[0], start = r.state(2, 5, 0), goal = r.state(6, 5, seed % layers)
          const expected = dijkstraCost(r, start, goal)
          for (const router of routers) {
            const actual = searchCost(router, start, goal).cost
            if (expected === Infinity) expect(actual).toBe(Infinity)
            else expect(actual).toBeCloseTo(expected, 8)
          }
          pruned += routers[2].searchStats.viaTransitionsPruned
        }
  expect(pruned).toBeGreaterThan(0)
})

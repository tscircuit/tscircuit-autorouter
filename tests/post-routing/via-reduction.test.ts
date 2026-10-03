import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions, wireTrace } from "./fixtures"

test("via objective removes an unnecessary two-layer excursion under zero additional length and bend budgets", () => {
  const input = boardFixture()
  input.srj.obstacles = []
  input.traces[0] = wireTrace("excursion", "signal-pair", [
    [0, 0],
    [3, 0],
  ])
  input.traces[0]!.route.push(
    {
      route_type: "via",
      x: 3,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
    { route_type: "wire", x: 3, y: 0, width: 0.4, layer: "bottom" },
    { route_type: "wire", x: 8, y: 0, width: 0.4, layer: "bottom" },
    {
      route_type: "via",
      x: 8,
      y: 0,
      from_layer: "bottom",
      to_layer: "top",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
    { route_type: "wire", x: 8, y: 0, width: 0.4, layer: "top" },
    { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "top" },
  )
  const options = phaseOptions()
  options.objective.priorities = ["viaSites"]
  const original = structuredClone(input)
  const result = optimizePostRouting(input, options)
  expect(result.status).toBe("accepted")
  expect(result.before!.viaSites).toBe(2)
  expect(result.after!.viaSites).toBe(0)
  expect(result.after!.copperLength).toBeLessThanOrEqual(
    result.before!.copperLength,
  )
  expect(result.after!.bends).toBeLessThanOrEqual(result.before!.bends)
  expect(input).toEqual(original)
})

import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions, wireTrace } from "./fixtures"

test("failure of a second net discards the successfully routed first net", () => {
  const input = boardFixture()
  input.srj.connections[1]!.pointsToConnect[1] = {
    x: 10,
    y: -2,
    layer: "bottom",
    pointId: "d",
  }
  input.srj.obstacles[3]!.layers = ["bottom"]
  input.traces[1] = wireTrace("fixed", "fixed-pair", [
    [0, -2],
    [5, -2],
  ])
  input.traces[1]!.route.push(
    {
      route_type: "via",
      x: 5,
      y: -2,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
    { route_type: "wire", x: 5, y: -2, width: 0.4, layer: "bottom" },
    { route_type: "wire", x: 10, y: -2, width: 0.4, layer: "bottom" },
  )
  const options = phaseOptions()
  options.nets.push({ net: "fixed", maxNewVias: 0, maxNewViasPerBranch: 0 })
  options.objective.maxChangedNets = 2
  const original = structuredClone(input)
  const result = optimizePostRouting(input, options)
  expect(result.status).toBe("rejected")
  expect(result.attempts.map((a) => a.solved)).toEqual([true, false])
  expect(result.diagnostics.join(" ")).toContain("Atomic rollback")
  expect(result.traces).toEqual(original.traces)
  expect(result.changedNets).toEqual([])
  expect(input).toEqual(original)
})

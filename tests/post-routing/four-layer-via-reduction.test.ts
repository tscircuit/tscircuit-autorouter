import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("four-layer via-only optimization removes two physical through barrels while preserving other copper", () => {
  const input = boardFixture()
  input.srj.layerCount = 4
  input.traces[0]!.route = [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.4 },
    { route_type: "wire", x: 0, y: 2, layer: "top", width: 0.4 },
    { route_type: "via", x: 0, y: 2, from_layer: "top", to_layer: "inner1", layers: ["top", "inner1", "inner2", "bottom"], via_diameter: 0.6, via_hole_diameter: 0.3 },
    { route_type: "wire", x: 0, y: 2, layer: "inner1", width: 0.4 },
    { route_type: "wire", x: 10, y: 2, layer: "inner1", width: 0.4 },
    { route_type: "via", x: 10, y: 2, from_layer: "inner1", to_layer: "top", via_diameter: 0.6, via_hole_diameter: 0.3 },
    { route_type: "wire", x: 10, y: 2, layer: "top", width: 0.4 },
    { route_type: "wire", x: 10, y: 0, layer: "top", width: 0.4 },
  ]
  const original = structuredClone(input)
  const options = phaseOptions()
  options.objective.priorities = ["viaSites"]
  options.objective.maxBendIncrease = 2
  const result = optimizePostRouting(input, options)
  expect(result.status).toBe("accepted")
  expect(result.validationStatus).toBe("validated")
  expect(result.before!.viaSites).toBe(2)
  expect(result.after!.viaSites).toBe(0)
  expect(result.changedNets).toEqual(["signal"])
  expect(result.traces.find(t => t.pcb_trace_id === input.traces[1]!.pcb_trace_id)).toEqual(input.traces[1])
  expect(input).toEqual(original)
})

import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("unsupported rules, owner ambiguities, mixed widths and changed preloads fail explicitly with immutable original input", () => {
  for (const defect of [
    "layers",
    "pairs",
    "npth",
    "drill",
    "plating",
    "owner",
    "width",
    "preload",
  ] as const) {
    const input = boardFixture()
    if (defect === "layers") input.srj.layerCount = 4
    if (defect === "pairs")
      input.srj.differentialPairs = [
        { connectionNames: ["signal", "fixed"], lengthTolerance: 0.1 },
      ]
    if (defect === "npth") input.srj.obstacles[0]!.isNonPlatedHole = true
    if (defect === "drill") {
      input.srj.obstacles[0]!.isPlated = true
      input.srj.obstacles[0]!.layers = ["top", "bottom"]
    }
    if (defect === "plating") input.srj.obstacles[0]!.layers = ["top", "bottom"]
    if (defect === "owner")
      input.traceOwners = new Map([
        ["signal-pair", "signal"],
        ["fixed-pair", "signal"],
        ["signal", "fixed"],
      ])
    if (defect === "width" && input.traces[0]!.route[0]!.route_type === "wire")
      input.traces[0]!.route[0]!.width = 0.6
    if (defect === "preload")
      input.srj.traces = [
        {
          ...structuredClone(input.traces[0]!),
          connection_name: "different-owner",
        },
      ]
    const original = structuredClone(input)
    expect(() => optimizePostRouting(input, phaseOptions())).toThrow()
    expect(input).toEqual(original)
  }
})

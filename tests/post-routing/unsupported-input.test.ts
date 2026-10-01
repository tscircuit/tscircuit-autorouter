import { expect, test } from "bun:test"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("unsupported physical inputs return uncertified unchanged output; invalid owners, widths and preloads still throw", () => {
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
    if (["layers", "pairs", "npth", "drill", "plating"].includes(defect)) {
      const result = optimizePostRouting(input, phaseOptions())
      expect(result.status).toBe("unsupported")
      expect(result.validationStatus).toBe("unsupported")
      expect(result.traces).toEqual(input.traces)
      expect(result.changedNets).toEqual([])
      expect(result.attempts).toEqual([])
      expect(result.before).toBeNull()
      expect(result.diagnostics.length).toBeGreaterThan(0)
    } else expect(() => optimizePostRouting(input, phaseOptions())).toThrow()
    expect(input).toEqual(original)
  }
})

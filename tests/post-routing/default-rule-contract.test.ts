import { expect, test } from "bun:test"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { boardFixture } from "./fixtures"

test("omitted via-in-pad permission remains false and declared obstacle margins stay binding", () => {
  const input = boardFixture()
  input.srj.defaultObstacleMargin = 0.3
  input.srj.minTraceToPadEdgeClearance = 0.05
  input.srj.minViaEdgeToPadEdgeClearance = 0.05
  const problem = createDynamicNetTreeProblem(
    input.srj,
    "signal",
    [],
    input.traceOwners,
  )
  expect(problem.allowViaInPad).toBe(false)
  expect(problem.clearance).toBe(0.3)
  expect(problem.viaToPadClearance).toBe(0.3)
  input.traces[0]!.route = [
    { route_type: "wire", x: 0, y: 0, width: 0.4, layer: "top" },
    { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x: 0, y: 0, width: 0.4, layer: "bottom" },
    { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "bottom" },
    { route_type: "via", x: 10, y: 0, from_layer: "bottom", to_layer: "top" },
    { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "top" },
  ]
  const original = structuredClone(input)
  expect(
    validatePostRoutingCandidate(
      input.srj,
      input.traces,
      input.traceOwners,
    ).diagnostics.some((d) => d.startsWith("Via in pad")),
  ).toBe(true)
  input.srj.allowViaInPad = true
  expect(
    validatePostRoutingCandidate(
      input.srj,
      input.traces,
      input.traceOwners,
    ).diagnostics.some((d) => d.startsWith("Via in pad")),
  ).toBe(false)
  delete input.srj.allowViaInPad
  expect(input).toEqual(original)
})

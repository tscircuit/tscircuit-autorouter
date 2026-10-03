import { expect, test } from "bun:test"
import { PostRoutingNetTreeSolver } from "lib/solvers/PostRoutingOptimization/PostRoutingNetTreeSolver"
import { PostRoutingOptimizationSolver } from "lib/solvers/PostRoutingOptimization/PostRoutingOptimizationSolver"
import { optimizePostRouting } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { boardFixture, phaseOptions } from "./fixtures"

test("incremental proposal records physical inserts and defers candidate validation to the atomic gate", () => {
  const input = boardFixture(),
    original = structuredClone(input)
  let validations = 0
  const options = {
    ...phaseOptions(),
    validate: () => {
      validations++
      return {
        valid: validations === 1,
        diagnostics: validations === 1 ? [] : ["manufacturing rejection"],
      }
    },
  }
  const proposal = new PostRoutingNetTreeSolver(input, options)
  proposal.solve()
  expect(proposal.solved).toBe(true)
  expect(validations).toBe(1)
  expect(proposal.iterations).toBeGreaterThan(1)
  expect(
    proposal
      .getRecordedGraphics()
      .texts!.some((text) => text.text.includes("forest branch")),
  ).toBe(true)
  const snapshot = proposal.getOutput().getSnapshot()
  snapshot.traces.length = 0
  const gate = new PostRoutingOptimizationSolver(proposal.getOutput())
  gate.solve()
  expect(validations).toBe(2)
  expect(gate.getOutput().status).toBe("rejected")
  expect(gate.getOutput().traces).toEqual(input.traces)
  expect(gate.getRecordedGraphics().texts!.at(-1)!.text).toContain(
    "Atomic rollback",
  )
  expect(input).toEqual(original)
  const plain = optimizePostRouting(input, phaseOptions())
  const p = new PostRoutingNetTreeSolver(input, phaseOptions())
  p.solve()
  const g = new PostRoutingOptimizationSolver(p.getOutput())
  g.solve()
  expect(g.getOutput().traces).toEqual(plain.traces)
})

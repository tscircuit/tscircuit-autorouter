import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("cached and continuity-off full references retain strict severity feedback and reject later loss of supported ownership", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: true })
  const evaluate = solver["cachedReferenceDrcEvaluator"]!
  const routes = structuredClone(fixture.params.newHdRoutes)
  const first = evaluate({ traces: [], routes, hdRoutes: routes })
  const firstErrors = Array.isArray(first) ? first : first.errors
  expect(firstErrors).toHaveLength(1)
  const count = solver.stats.originalOwnerCopperFeedback.referenceEvaluations
  expect(evaluate({ traces: [], routes, hdRoutes: routes })).toBe(first)
  expect(solver.stats.originalOwnerCopperFeedback.referenceEvaluations).toBe(count)
  const precision = solver["clearancePrecisionDrcEvaluator"]!({ traces: [], routes, hdRoutes: routes })
  expect(Array.isArray(precision) ? precision : precision.errors).toHaveLength(1)
  const worse = structuredClone(routes)
  worse[0]!.route[1]!.y = 0.02; worse[0]!.route[2]!.y = 0.02; worse[0]!.vias[0]!.y = 0.02
  const worsened = evaluate({ traces: [], routes: worse, hdRoutes: worse })
  const worseErrors = Array.isArray(worsened) ? worsened : worsened.errors
  expect(worseErrors).toHaveLength(1)
  expect(Number(worseErrors[0]!.actual_clearance)).toBeLessThan(Number(firstErrors[0]!.actual_clearance))
  fixture.params.originalSrj.connections[0]!.name = "now_missing_original_owner"
  const changed = structuredClone(routes)
  changed[0]!.route[1]!.y = -0.01; changed[0]!.route[2]!.y = -0.01; changed[0]!.vias[0]!.y = -0.01
  expect(() => evaluate({ traces: [], routes: changed, hdRoutes: changed })).toThrow("Supported original-owner feedback lost candidate ownership or geometry")
})

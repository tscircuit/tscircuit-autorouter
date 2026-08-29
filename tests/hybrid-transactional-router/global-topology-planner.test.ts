import { expect, test } from "bun:test"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestProblem } from "./fixtures"

test("builds a deterministic coupled-aware global topology plan", () => {
  const problem = createHybridRoutingTestProblem()
  const options = {
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  }

  const first = planGlobalTopology(options)
  const second = planGlobalTopology(options)
  const pairPlan = first.routeObjectPlans.find(
    (plan) => plan.routeObjectKind === "differential_pair",
  )

  expect(first).toEqual(second)
  expect(first.routeObjectPlans).toHaveLength(4)
  expect(pairPlan?.topology).toBe("coupled_parallel")
  expect(pairPlan?.connectionNames).toEqual([
    "diff_positive",
    "diff_negative",
  ])
  expect(pairPlan?.coupledEnvelopeReserveMm).toBeGreaterThan(0)
  expect(
    first.routeObjectPlans.every((plan) => plan.estimatedSolverWork > 0),
  ).toBe(true)
})

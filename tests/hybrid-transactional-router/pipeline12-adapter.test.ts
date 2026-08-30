import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver12_HybridTransactionalRouter } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/AutoroutingPipelineSolver12_HybridTransactionalRouter"
import type { HybridRoutingCoreRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/rust-core-protocol"
import { createHybridRoutingTestFixture } from "./fixtures"

test("keeps the opt-in async adapter fail-closed on a non-solved result", async () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const runtime: HybridRoutingCoreRuntime = {
    target: "wasm",
    async execute() {
      throw new Error("contradictory rules must fail before runtime execution")
    },
  }
  const solver = new AutoroutingPipelineSolver12_HybridTransactionalRouter(
    simpleRouteJson,
    {
      routingRules: {
        ...routingRules,
        layerStack: routingRules.layerStack.slice(0, -1),
      },
      execution: { kind: "serial", runtime },
    },
  )

  await solver.solveAsync()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getResult()?.status).toBe("failed")
  expect(() => solver.getOutput()).toThrow(
    "Pipeline 12 does not have a verified solved output",
  )
})

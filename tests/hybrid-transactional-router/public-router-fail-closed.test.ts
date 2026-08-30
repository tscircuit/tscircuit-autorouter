import { expect, test } from "bun:test"
import { HybridTransactionalRegionalRouter } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/hybrid-transactional-regional-router"
import type { HybridRoutingCoreRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/rust-core-protocol"
import { createHybridRoutingTestFixture } from "./fixtures"

test("returns a structured failure before search for contradictory public rules", async () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  let executionCount = 0
  const runtime: HybridRoutingCoreRuntime = {
    target: "native",
    async execute() {
      executionCount += 1
      throw new Error("search must not run")
    },
  }
  const router = new HybridTransactionalRegionalRouter(simpleRouteJson, {
    routingRules: {
      ...routingRules,
      routeClasses: routingRules.routeClasses.map((routeClass) =>
        routeClass.className === "signal"
          ? {
              ...routeClass,
              viaBudget: { softMaximum: 6, hardMaximum: 5 },
            }
          : routeClass,
      ),
    },
    execution: { kind: "serial", runtime },
  })

  const result = await router.route()

  expect(result.status).toBe("failed")
  if (result.status !== "failed") return
  expect(result.metrics.solveOutcome).toBe("failed")
  expect(result.diagnostic.code).toBe("hybrid_router_exception")
  expect(result.diagnostic.message).toContain("viaBudget")
  expect(executionCount).toBe(0)
})

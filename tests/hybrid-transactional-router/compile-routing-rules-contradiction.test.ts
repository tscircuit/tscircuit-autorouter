import { expect, test } from "bun:test"
import {
  compileRoutingRules,
  HybridRoutingRuleCompilationError,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { createHybridRoutingTestFixture } from "./fixtures"

test("rejects a route class whose soft via budget exceeds its hard limit", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const contradictoryRules = {
    ...routingRules,
    routeClasses: routingRules.routeClasses.map((routeClass) =>
      routeClass.className === "signal"
        ? {
            ...routeClass,
            viaBudget: { softMaximum: 6, hardMaximum: 5 },
          }
        : routeClass,
    ),
  }

  expect(() =>
    compileRoutingRules({
      simpleRouteJson,
      routingRules: contradictoryRules,
    }),
  ).toThrow(HybridRoutingRuleCompilationError)
  try {
    compileRoutingRules({
      simpleRouteJson,
      routingRules: contradictoryRules,
    })
  } catch (error) {
    expect(error).toBeInstanceOf(HybridRoutingRuleCompilationError)
    expect((error as HybridRoutingRuleCompilationError).code).toBe(
      "contradictory_rule",
    )
    expect((error as HybridRoutingRuleCompilationError).rulePath).toContain(
      "viaBudget",
    )
  }
})

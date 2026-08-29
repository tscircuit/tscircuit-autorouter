import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestFixture } from "./fixtures"

test("adds a deterministic closure corridor for a compiled power mesh", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const powerConnection = simpleRouteJson.connections.find(
    (connection) => connection.name === "power_vcc",
  )!
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({
      simpleRouteJson: {
        ...simpleRouteJson,
        connections: simpleRouteJson.connections.map((connection) =>
          connection.name === "power_vcc"
            ? {
                ...powerConnection,
                pointsToConnect: [
                  ...powerConnection.pointsToConnect,
                  {
                    x: 0,
                    y: 6,
                    layer: "top",
                    pointId: "power_vcc_branch",
                  },
                ],
              }
            : connection,
        ),
      },
      routingRules: {
        ...routingRules,
        powerRules: routingRules.powerRules!.map((powerRule) =>
          powerRule.connectionName === "power_vcc"
            ? { ...powerRule, topology: "mesh" as const }
            : powerRule,
        ),
      },
    }),
  )

  const powerPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
  }).routeObjectPlans.find(
    (routePlan) => routePlan.routeObjectId === "power:power_vcc",
  )!

  expect(powerPlan.topology).toBe("mesh")
  expect(powerPlan.corridors).toHaveLength(3)
  expect(new Set(powerPlan.corridors.map((corridor) => corridor.corridorId)).size).toBe(
    3,
  )
})

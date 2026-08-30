import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { isConnectionFullyConnected } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestFixture } from "./fixtures"

test("treats a valid one-terminal connection as already satisfied", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const input = {
    ...simpleRouteJson,
    connections: simpleRouteJson.connections.map((connection) =>
      connection.name === "signal_plain"
        ? {
            ...connection,
            pointsToConnect: [connection.pointsToConnect[0]!],
          }
        : connection,
    ),
  }
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({ simpleRouteJson: input, routingRules }),
  )
  const connection = problem.compiledRules.connections.find(
    (candidate) => candidate.connectionName === "signal_plain",
  )
  if (!connection) throw new Error("fixture is missing signal_plain")
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 1_000_000,
  })

  expect(connection.terminals).toHaveLength(1)
  expect(
    isConnectionFullyConnected({
      compiledRules: problem.compiledRules,
      copperSnapshot: { version: 0, segments: [], vias: [] },
      connection,
    }),
  ).toBe(true)
  expect(
    topologyPlan.routeObjectPlans.some((plan) =>
      plan.connectionNames.includes("signal_plain"),
    ),
  ).toBe(false)
})

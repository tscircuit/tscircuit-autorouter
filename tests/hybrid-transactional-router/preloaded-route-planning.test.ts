import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestFixture } from "./fixtures"

test("does not schedule a route object already satisfied by preloaded copper", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const signalConnection = simpleRouteJson.connections.find(
    (connection) => connection.name === "signal_plain",
  )
  if (!signalConnection) throw new Error("fixture is missing signal_plain")
  const [start, end] = signalConnection.pointsToConnect
  if (!start || !end) throw new Error("fixture signal must have two terminals")
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({
      simpleRouteJson: {
        ...simpleRouteJson,
        traces: [
          {
            type: "pcb_trace",
            pcb_trace_id: "preloaded_signal_plain",
            connection_name: "signal_plain",
            route: [
              {
                route_type: "wire",
                x: start.x,
                y: start.y,
                width: 0.18,
                layer: "top",
              },
              {
                route_type: "wire",
                x: end.x,
                y: end.y,
                width: 0.18,
                layer: "top",
              },
            ],
          },
        ],
      },
      routingRules,
    }),
  )

  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  })

  expect(
    topologyPlan.routeObjectPlans.some(
      (routePlan) => routePlan.routeObjectId === "signal:signal_plain",
    ),
  ).toBe(false)
  expect(topologyPlan.routeObjectPlans).toHaveLength(3)
})

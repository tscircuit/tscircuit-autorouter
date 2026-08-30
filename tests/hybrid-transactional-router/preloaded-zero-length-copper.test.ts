import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestFixture } from "./fixtures"

test("does not materialize degenerate segments beside a preloaded via", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
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
                x: -8,
                y: 3.5,
                width: 0.18,
                layer: "top",
              },
              {
                route_type: "via",
                x: -6,
                y: 3.5,
                from_layer: "top",
                to_layer: "bottom",
              },
              {
                route_type: "wire",
                x: -6,
                y: 3.5,
                width: 0.18,
                layer: "bottom",
              },
              {
                route_type: "wire",
                x: -4,
                y: 3.5,
                width: 0.18,
                layer: "bottom",
              },
            ],
          },
        ],
      },
      routingRules,
    }),
  )
  const snapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  }).getSnapshot()

  expect(snapshot.segments).toHaveLength(2)
  expect(
    snapshot.segments.every(
      (segment) =>
        segment.start.x !== segment.end.x || segment.start.y !== segment.end.y,
    ),
  ).toBe(true)
})

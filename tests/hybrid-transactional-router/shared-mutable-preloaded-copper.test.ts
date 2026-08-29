import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestFixture } from "./fixtures"

test("preserves every authoritative owner for shared mutable preloaded copper", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const sharedRules = {
    ...routingRules,
    preloadedCopperOwnership: [
      {
        pcbTraceId: "preloaded_signal_plain",
        mutability: "mutable" as const,
        ownerConnectionNames: ["signal_plain", "bus_0"],
      },
    ],
  }
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({ simpleRouteJson, routingRules: sharedRules }),
  )
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })

  const [preloadedVia] = store.getSnapshot().vias

  expect(preloadedVia?.ownership.mutability).toBe("mutable")
  if (preloadedVia?.ownership.mutability !== "mutable") return
  expect(preloadedVia.ownership.ownerRouteObjectIds).toEqual([
    "signal:signal_plain",
    "bus:control_bus",
  ])
})

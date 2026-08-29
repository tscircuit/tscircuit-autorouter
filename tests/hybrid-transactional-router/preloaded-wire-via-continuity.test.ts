import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestProblem } from "./fixtures"

test("materializes both wire spans adjacent to a preloaded via", () => {
  const problem = createHybridRoutingTestProblem()
  const snapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  }).getSnapshot()

  expect(
    snapshot.segments.map((segment) => ({
      copperId: segment.copperId,
      layer: segment.layer,
      start: segment.start,
      end: segment.end,
    })),
  ).toEqual([
    {
      copperId: "preloaded_signal_plain:segment:0",
      layer: "top",
      start: { x: -8, y: 3.5 },
      end: { x: -6, y: 3.5 },
    },
    {
      copperId: "preloaded_signal_plain:segment:1",
      layer: "bottom",
      start: { x: -6, y: 3.5 },
      end: { x: -4, y: 3.5 },
    },
  ])
  expect(snapshot.vias.map((via) => via.copperId)).toEqual([
    "preloaded_signal_plain:via:1",
  ])
})

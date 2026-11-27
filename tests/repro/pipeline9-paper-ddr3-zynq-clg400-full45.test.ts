import { expect, test } from "bun:test"
import { optimizePaperDdr3Routing } from "tests/fixtures/optimizePaperDdr3Routing"
import {
  expectPaperDdr3RoutingSnapshot,
  runPaperDdr3Routing,
} from "tests/fixtures/runPaperDdr3Routing"

test("routes the Zynq Full45 DDR3 bytes with Bus Lanes and completes the bus with Pipeline 9", async (): Promise<void> => {
  const routing = await runPaperDdr3Routing("zynq-clg400-full45", {
    optimizeVias: true,
  })
  expect(routing.inputSrj.connections).toHaveLength(45)
  expect(routing.inputSrj.differentialPairs).toHaveLength(2)
  const optimized = optimizePaperDdr3Routing(routing)
  expect(optimized.optimizedViaCount).toBeLessThan(optimized.originalViaCount)
  await expectPaperDdr3RoutingSnapshot(optimized.routing, import.meta.path)
})

import { expect, test } from "bun:test"
import { createHybridBenchmarkRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/benchmark-routing-rules"
import { prepareHybridBenchmarkInput } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/benchmark-routing-rules"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { createHybridRoutingTestFixture } from "./fixtures"

test("creates explicit compilable benchmark rules without downstream defaults", () => {
  const { simpleRouteJson } = createHybridRoutingTestFixture()
  const sourceWithoutBenchmarkDefaults = {
    ...simpleRouteJson,
    minViaHoleDiameter: undefined,
    minViaPadDiameter: undefined,
    defaultObstacleMargin: undefined,
  }
  const prepared = prepareHybridBenchmarkInput(sourceWithoutBenchmarkDefaults)
  const routingRules = createHybridBenchmarkRoutingRules(prepared.input)
  const preparedTraceToPadClearance =
    prepared.input.minTraceToPadEdgeClearance
  if (preparedTraceToPadClearance === undefined) {
    throw new Error("prepared benchmark input is missing trace-to-pad clearance")
  }

  const compiled = compileRoutingRules({
    simpleRouteJson: prepared.input,
    routingRules,
  })

  expect(compiled.layerStack.map((layer) => layer.name)).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(routingRules.routeClasses).toHaveLength(
    simpleRouteJson.connections.length,
  )
  expect(compiled.preloadedCopper[0]?.mutability).toBe("immutable")
  expect(compiled.connections.every((connection) => connection.viaBudget.hardMaximum >= 8)).toBe(
    true,
  )
  expect(prepared.policy.inferredFields).toEqual([
    "minViaHoleDiameter",
    "minViaPadDiameter",
    "defaultObstacleMargin",
    "minTraceToPadEdgeClearance",
    "minViaEdgeToPadEdgeClearance",
    "minBoardEdgeClearance",
  ])
  expect(prepared.policy.defaultClearanceMm).toBe(0.1)
  expect(compiled.clearances.traceToPadEdgeMm).toBe(
    preparedTraceToPadClearance,
  )
  expect(sourceWithoutBenchmarkDefaults.minViaHoleDiameter).toBeUndefined()
})

import { expect, test } from "bun:test"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { createHybridRoutingTestFixture } from "./fixtures"

test("compiles a complete immutable routing rule model", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const compiledRules = compileRoutingRules({ simpleRouteJson, routingRules })

  expect(compiledRules.layerStack.map((layer) => layer.name)).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(compiledRules.connections).toHaveLength(6)
  expect(
    compiledRules.connections.find(
      (connection) => connection.connectionName === "bus_0",
    )?.traceWidthMm,
  ).toBe(0.16)
  expect(
    compiledRules.connections.find(
      (connection) => connection.connectionName === "power_vcc",
    ),
  ).toMatchObject({ kind: "power", topology: "tree", traceWidthMm: 0.5 })
  expect(compiledRules.differentialPairs[0]).toMatchObject({
    spacingMm: 0.18,
    maximumSkewMm: 0.08,
    maximumUncoupledLengthMm: 1.5,
  })
  expect(compiledRules.preloadedCopper[0]?.trace.route[1]).toMatchObject({
    route_type: "via",
    via_diameter: 0.4,
    via_hole_diameter: 0.2,
  })
  expect(Object.isFrozen(compiledRules)).toBe(true)
  expect(Object.isFrozen(compiledRules.connections)).toBe(true)
  expect(Object.isFrozen(compiledRules.preloadedCopper[0]?.trace.route)).toBe(
    true,
  )
})

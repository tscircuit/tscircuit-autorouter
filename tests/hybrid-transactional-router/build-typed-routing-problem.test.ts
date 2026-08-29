import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { createHybridRoutingTestFixture } from "./fixtures"

test("builds coupled route objects with one authoritative owner per connection", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const compiledRules = compileRoutingRules({ simpleRouteJson, routingRules })
  const routingProblem = buildTypedRoutingProblem(compiledRules)

  expect(routingProblem.routeObjects.map((routeObject) => routeObject.kind)).toEqual(
    ["bus", "differential_pair", "power", "signal", "preloaded_copper"],
  )
  const busRouteObject = routingProblem.routeObjects.find(
    (routeObject) => routeObject.kind === "bus",
  )
  expect(busRouteObject?.kind).toBe("bus")
  if (busRouteObject?.kind === "bus") {
    expect(busRouteObject.members.map((member) => member.kind)).toEqual([
      "signal",
      "signal",
    ])
    expect(busRouteObject.members.every((member) => member.ownership.kind === "delegated")).toBe(
      true,
    )
  }
  const differentialPair = routingProblem.routeObjects.find(
    (routeObject) => routeObject.kind === "differential_pair",
  )
  expect(differentialPair?.validationRequirements).toContain(
    "maximum_uncoupled_pair_length",
  )
  expect(routingProblem.ownershipByConnection).toHaveLength(6)
  expect(new Set(routingProblem.ownershipByConnection.map((record) => record.connectionName)).size).toBe(
    6,
  )
  expect(Object.isFrozen(routingProblem.routeObjects)).toBe(true)
})

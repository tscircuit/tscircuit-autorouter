import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"
import fixture from "../fixtures/rvboy-leading-via.json"

test("RVboy reconstruction connects a leading via in either serialized direction", (): void => {
  const connMap = new ConnectivityMap({})
  for (const reverseVia of [false, true]) {
    const trace = structuredClone(fixture) as SimplifiedPcbTrace
    const via = trace.route[0]!
    if (via.route_type !== "via")
      throw new Error("Expected captured leading via")
    if (reverseVia)
      [via.from_layer, via.to_layer] = [via.to_layer, via.from_layer]
    const routes = convertPreloadedTraceToHdRoutes(trace, 0, 4, 0.45, connMap)
    const params = {
      originalTraces: [trace],
      originalFixedRoutes: routes,
      updatedFixedRoutes: routes,
      replacedConnectionNames: new Set([routes[1]!.connectionName]),
      layerCount: 4,
      defaultViaHoleDiameter: 0.2,
      obstacles: [],
      connMap,
    }
    const result = applyFixedRouteReplacementsToPreloadedTraces(params)
    const rebuilt = result.updatedPreloadedTraces[0]!
    expect(rebuilt.route.filter((p) => p.route_type === "via")).toEqual([
      { ...via, from_layer: "inner1", to_layer: "top" },
    ])
    expect(rebuilt.route.at(-1)).toEqual(trace.route.at(-1))
    expect(rebuilt.route[0]).toMatchObject({
      x: via.x,
      y: via.y,
      layer: "inner1",
    })
    expect(trace).toEqual(
      reverseVia
        ? {
            ...fixture,
            route: [
              { ...fixture.route[0], from_layer: "inner1", to_layer: "top" },
              ...fixture.route.slice(1),
            ],
          }
        : fixture,
    )
    const disconnected = structuredClone(routes)
    disconnected[1]!.route[0]!.x += 0.05
    expect(() =>
      applyFixedRouteReplacementsToPreloadedTraces({
        ...params,
        updatedFixedRoutes: disconnected,
      }),
    ).toThrow("could not reconnect")
  }
})

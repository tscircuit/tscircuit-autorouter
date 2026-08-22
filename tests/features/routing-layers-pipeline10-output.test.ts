import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { routeUsesOnlyRoutingLayers } from "../helpers/route-uses-only-routing-layers"

test("Pipeline 10 constrains both BGA fanout and autorouted copper", () => {
  const input = structuredClone(sample001) as SimpleRouteJson
  input.routingLayers = ["top", "bottom"]
  input.connections = input.connections.slice(0, 1)
  input.buses = []
  input.differentialPairs = []

  const solver = new AutoroutingPipelineSolver10_BgaFanout(input, {
    cacheProvider: null,
  })
  solver.solve()
  const traces = solver.getOutputSimpleRouteJson().traces ?? []
  const allowedLayers = new Set(input.routingLayers)

  expect(solver.failed).toBe(false)
  expect(traces.length).toBeGreaterThan(1)
  expect(
    traces.every((trace) =>
      routeUsesOnlyRoutingLayers(trace, allowedLayers),
    ),
  ).toBe(true)
})

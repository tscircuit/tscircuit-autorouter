import { expect, test } from "bun:test"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import {
  postRoutingLayerIndex,
  postRoutingViaLayers,
} from "lib/solvers/DynamicNetTreeSolver/postRoutingLayers"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { measurePostRoutingMetrics } from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import { boardFixture } from "./fixtures"

test("through and blind barrels use physical spans independently of their signal endpoints", () => {
  const input = boardFixture()
  input.srj.layerCount = 4
  const via = {
    route_type: "via" as const,
    x: 5,
    y: 5,
    from_layer: "top",
    to_layer: "inner1",
    via_diameter: 0.6,
    via_hole_diameter: 0.3,
  }
  expect(postRoutingViaLayers(input.srj, via)).toEqual([0, 1, 2, 3])
  input.srj.allowBlindAndBuriedVias = true
  expect(postRoutingViaLayers(input.srj, via)).toEqual([0, 1])
  expect(
    postRoutingViaLayers(input.srj, {
      ...via,
      layers: ["top", "inner1", "inner2"],
    }),
  ).toEqual([0, 1, 2])
  for (const layers of [
    ["top"],
    ["top", "inner2"],
    ["top", "inner1", "inner1"],
    ["inner1", "inner2"],
    ["top", "inner1x"],
  ])
    expect(() => postRoutingViaLayers(input.srj, { ...via, layers })).toThrow()
  for (const layer of [
    "inner0",
    "inner3",
    "inner01",
    "inner1x",
    "inner9",
    "front",
  ])
    expect(() => postRoutingLayerIndex(layer, 4)).toThrow()
  input.srj.allowBlindAndBuriedVias = false
  expect(() =>
    postRoutingViaLayers(input.srj, { ...via, layers: ["top", "inner1"] }),
  ).toThrow()
  const trace = structuredClone(input.traces[0]!)
  trace.route = [
    { route_type: "wire", x: 5, y: 5, width: 0.4, layer: "top" },
    via,
    { route_type: "wire", x: 5, y: 5, width: 0.4, layer: "inner1" },
    { route_type: "wire", x: 6, y: 5, width: 0.4, layer: "inner1" },
  ]
  input.srj.obstacles.push({
    type: "rect",
    center: { x: 5, y: 5 },
    width: 1,
    height: 1,
    layers: ["inner2"],
    connectedTo: ["fixed"],
  })
  const through = createDynamicNetTreeProblem(
    input.srj,
    "signal",
    [trace],
    input.traceOwners,
  )
  expect(through.copper.find((c) => c.kind === "via")!.layers).toEqual([
    0, 1, 2, 3,
  ])
  expect(
    validatePostRoutingCandidate(
      input.srj,
      [trace, input.traces[1]!],
      input.traceOwners,
    ).diagnostics.some(
      (d) => d.startsWith("Foreign copper clearance") && d.includes(":via:"),
    ),
  ).toBe(true)
  input.srj.allowBlindAndBuriedVias = true
  expect(
    createDynamicNetTreeProblem(
      input.srj,
      "signal",
      [trace],
      input.traceOwners,
    ).copper.find((c) => c.kind === "via")!.layers,
  ).toEqual([0, 1])
  const other = structuredClone(trace)
  other.pcb_trace_id = "stacked"
  const barrel = other.route[1]!
  if (barrel.route_type !== "via") throw Error("Missing fixture via")
  barrel.from_layer = "inner2"
  barrel.to_layer = "bottom"
  expect(
    measurePostRoutingMetrics([trace, other], input.traceOwners, input.srj)
      .viaSites,
  ).toBe(2)
  expect(
    measurePostRoutingMetrics(
      [trace, structuredClone(trace)],
      input.traceOwners,
      input.srj,
    ).viaSites,
  ).toBe(1)
})

import { expect, test } from "bun:test"
import { validatePostRoutingCandidate } from "lib/solvers/PostRoutingOptimization/validatePostRoutingCandidate"
import { measurePostRoutingMetrics } from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import { boardFixture } from "./fixtures"

test("a plated-land traversal needs exact source identity, ownership, span and endpoint containment", () => {
  const input = boardFixture()
  input.srj.layerCount = 4
  const pad = input.srj.obstacles[1]!
  pad.layers = ["top", "inner1", "inner2", "bottom"]
  pad.isPlated = true
  pad.holeDiameter = 0.3
  pad.holeShape = "circle"
  pad.circuitJsonMetadata = { pcb_plated_hole_id: "bridge" }
  input.traces[0]!.route = [
    { route_type: "wire", x: 0, y: 0, width: 0.4, layer: "top" },
    { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "top" },
    {
      route_type: "through_obstacle",
      start: { x: 10, y: 0 },
      end: { x: 10, y: 0 },
      from_layer: "top",
      to_layer: "inner2",
      width: 0.4,
      circuitJsonMetadata: { pcb_plated_hole_id: "bridge" },
    },
    { route_type: "wire", x: 10, y: 0, width: 0.4, layer: "inner2" },
    { route_type: "wire", x: 10.1, y: 0, width: 0.4, layer: "inner2" },
  ]
  expect(
    validatePostRoutingCandidate(input.srj, input.traces, input.traceOwners)
      .valid,
  ).toBe(true)
  expect(
    measurePostRoutingMetrics(input.traces, input.traceOwners, input.srj)
      .viaSites,
  ).toBe(0)
  for (const defect of [
    "identity",
    "owner",
    "plating",
    "span",
    "outside",
  ] as const) {
    const bad = structuredClone(input)
    const land = bad.srj.obstacles[1]!
    if (defect === "identity")
      land.circuitJsonMetadata = { pcb_plated_hole_id: "other" }
    if (defect === "owner") land.connectedTo = ["fixed"]
    if (defect === "plating") land.isPlated = false
    if (defect === "span") land.layers = ["top", "inner1"]
    if (defect === "outside") land.center.x = 12
    expect(() =>
      validatePostRoutingCandidate(bad.srj, bad.traces, bad.traceOwners),
    ).toThrow()
  }
})

import { expect, test } from "bun:test"
import { measurePostRoutingMetrics } from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import { wireTrace } from "./fixtures"

test("metrics union overlapping same-net copper and sites, keeping foreign-net and layer copper separate", () => {
  const traces = [
    wireTrace("a", "N", [
      [0, 0],
      [10, 0],
    ]),
    wireTrace("b", "N", [
      [8, 0],
      [2, 0],
    ]),
    wireTrace("c", "N", [
      [5, 0],
      [5, 3],
    ]),
    wireTrace("d", "F", [
      [0, 0],
      [10, 0],
    ]),
    wireTrace(
      "e",
      "N",
      [
        [0, 0],
        [10, 0],
      ],
      0.4,
      "bottom",
    ),
  ]
  traces[0]!.route.push({
    route_type: "via",
    x: 10,
    y: 0,
    from_layer: "top",
    to_layer: "bottom",
  })
  traces[1]!.route.push({
    route_type: "via",
    x: 10,
    y: 0,
    from_layer: "top",
    to_layer: "bottom",
  })
  const metrics = measurePostRoutingMetrics(
    traces,
    new Map([
      ["N", "N"],
      ["F", "F"],
    ]),
  )
  expect(metrics.copperLength).toBe(33)
  expect(metrics.viaSites).toBe(1)
  expect(metrics.bends).toBe(0)
})

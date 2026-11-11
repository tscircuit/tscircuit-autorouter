import { expect, test } from "bun:test"
import { getDifferentialPairRoutingFailure, getRoutingFailure } from "lib"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("finite-width nonlocal self-overlap cannot inflate an owned lane", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        [0, 0],
        [4, 0],
        [4, 0.1],
        [1, 0.1],
      ].map(([x, y]) => ({ x: x!, y: y!, z: 0 })),
    },
    {
      connectionName: "N",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: 3, z: 0 },
        { x: 7.1, y: 3, z: 0 },
      ],
    },
  ]
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 9, minY: -1, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.2,
    obstacles: [],
    differentialPairs: [
      { connectionNames: [["P"], ["N"]], maxLengthSkewMm: 0 },
    ],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
  }
  const traces: SimplifiedPcbTrace[] = routes.map((route) => ({
    type: "pcb_trace",
    pcb_trace_id: route.connectionName,
    connection_name: route.connectionName,
    route: route.route.map((point) => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      layer: "top",
      width: 0.2,
    })),
  }))
  expect(getDifferentialPairRoutingFailure(input, traces)).toEqual({
    reason: "ownership_violation",
    pairIndex: 0,
    connectionName: "P",
  })
  const solver = new LengthMatchingPostProcessingSolver({
    ...input,
    hdRoutes: routes,
    differentialPairs: input.differentialPairs!,
    buses: [],
    obstacleMargin: 0.1,
  })
  try {
    solver.solve()
    throw new Error("Expected ownership rejection")
  } catch (error) {
    expect(getRoutingFailure(error)).toEqual({
      reason: "ownership_violation",
      pairIndex: 0,
      connectionName: "P",
    })
  }
})

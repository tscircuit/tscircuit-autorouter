import { expect, test } from "bun:test"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createRetainedCopperPortPlacementValidator } from "lib/solvers/UniformPortDistributionSolver/createRetainedCopperPortPlacementValidator"
import type { SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Uniform keeps each retained Cu contact safe without freezing ripped sections", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 30 },
    obstacles: [],
    connections: [
      {
        name: "copper",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "copper-start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "copper-end" },
        ],
      },
      {
        name: "signal",
        pointsToConnect: [
          { x: -5, y: -5, layer: "top" },
          { x: -4, y: -4, layer: "top" },
        ],
      },
      {
        name: "copper-alias",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "copper-start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "copper-end" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "retained-wire",
        connection_name: "copper",
        route: [
          {
            route_type: "wire",
            x: 2.047311772873921,
            y: 24.737939360508197,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 4.049571479758547,
            y: 22.73567965362357,
            width: 0.9,
            layer: "top",
          },
        ],
      },
    ],
  }
  const original = structuredClone(srj)
  const point = (
    x: number,
    y: number,
    z = 0,
    connectionName = "signal",
  ): PortPoint => ({
    portPointId: "shared-port",
    connectionName,
    rootConnectionName: connectionName,
    x,
    y,
    z,
  })
  const validator = (
    input: SimpleRouteJson,
    sections: readonly ChangedPreloadedTraceSection[] = [],
  ): ReturnType<typeof createRetainedCopperPortPlacementValidator> =>
    createRetainedCopperPortPlacementValidator({
      srj: input,
      sections,
      connMap: getConnectivityMapFromSimpleRouteJson(input),
      traceWidth: 0.15,
      clearance: 0.1,
    })
  const admits = validator(srj)
  // Actual unchanged global point was safe; redistribution introduced overlap.
  const before = point(2.921666666666667, 24.22)
  const unsafe = point(2.59, 24.22)
  expect(admits([unsafe], [before])).toBe(false)
  expect(admits([before], [before])).toBe(true)
  expect(admits([point(3.1, 24.22)], [before])).toBe(true)
  // The final point's width does not inflate the wire starting before it.
  expect(admits([before], [point(3.3, 24.22)])).toBe(true)
  expect(admits([point(2.59, 24.22, 1)], [point(2.92, 24.22, 1)])).toBe(true)
  expect(
    admits([point(2.59, 24.22, 0, "copper-alias")], [point(2.92, 24.22, 0, "copper-alias")]),
  ).toBe(true)
  expect(() => admits([point(2.59, 24.22, 0, "unknown")], [point(2.92, 24.22, 0, "unknown")])).toThrow()

  const ripped: ChangedPreloadedTraceSection = {
    connectionName: "ripped-section" as ChangedPreloadedTraceSection["connectionName"],
    traceId: "retained-wire",
    startRoutePosition: 0,
    endRoutePosition: 1,
    connection: {
      name: "ripped-section",
      pointsToConnect: [
        { x: 2.047311772873921, y: 24.737939360508197, layer: "top" },
        { x: 4.049571479758547, y: 22.73567965362357, layer: "top" },
      ],
    },
  }
  expect(validator(srj, [ripped])([unsafe], [before])).toBe(true)

  const dirty = structuredClone(srj)
  dirty.traces![0]!.route = [
    { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
    { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
  ]
  const dirtyAdmits = validator(dirty)
  expect(dirtyAdmits([point(0, 0.1)], [point(0, 0.1)])).toBe(true)
  expect(dirtyAdmits([point(0, 0.12)], [point(0, 0.1)])).toBe(true)
  expect(dirtyAdmits([point(0, 0.08)], [point(0, 0.1)])).toBe(false)

  const publishedWidth = structuredClone(dirty)
  publishedWidth.traces!.push({
    type: "pcb_trace",
    pcb_trace_id: "own-ripped-wire",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 5, y: 5, width: 0.2, layer: "top" },
      { route_type: "wire", x: 6, y: 5, width: 0.2, layer: "top" },
    ],
  })
  const widerSection: ChangedPreloadedTraceSection = {
    ...ripped,
    traceId: "own-ripped-wire",
    connection: {
      name: "ripped-section",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 5, y: 5, layer: "top" },
        { x: 6, y: 5, layer: "top" },
      ],
    },
  }
  expect(
    validator(publishedWidth, [widerSection])(
      [point(0, 0.26, 0, "ripped-section")],
      [point(0, 0.4, 0, "ripped-section")],
    ),
  ).toBe(false)

  const annulus = structuredClone(srj)
  annulus.traces![0]!.route = [
    {
      route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom",
      via_diameter: 2, via_hole_diameter: 1.5,
    },
  ]
  expect(validator(annulus)([point(0.1, 0, 2)], [point(0, 0, 2)])).toBe(true)
  expect(validator(annulus)([point(0.8, 0, 2)], [point(0, 0, 2)])).toBe(false)
  annulus.allowBlindAndBuriedVias = true
  const via = annulus.traces![0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected original barrel")
  via.to_layer = "inner1"
  via.layers = ["top", "inner1"]
  expect(validator(annulus)([point(0.8, 0, 2)], [point(0, 0, 2)])).toBe(true)
  expect(validator(annulus)([point(0.8, 0, 1)], [point(0, 0, 1)])).toBe(false)
  expect(srj).toEqual(original)
})

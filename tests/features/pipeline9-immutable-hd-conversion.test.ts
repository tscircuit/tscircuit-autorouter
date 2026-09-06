import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline9ImmutableHdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ImmutableHdRoutesToSimplifiedPcbTracesConverter"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPreparedCircuitJsonConverter,
} from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"

test("Pipeline9 immutable HD conversion preserves fresh conversion semantics and sparse identities", (): void => {
  const connectionA: SimpleRouteConnection = {
    name: "A",
    pointsToConnect: [
      {
        x: -4,
        y: 0,
        layer: "top",
        pointId: "A-left",
        pcb_port_id: "A-left",
        terminalVia: { toLayer: "bottom", viaDiameter: 0.6 },
      },
      {
        x: 4,
        y: 0,
        layer: "top",
        pointId: "A-right",
        pcb_port_id: "A-right",
        terminalVia: { toLayer: "bottom", viaDiameter: 0.8 },
      },
    ],
  }
  const connectionB: SimpleRouteConnection = {
    name: "B",
    pointsToConnect: [
      { x: -4, y: -2, layer: "bottom", pointId: "B-left" },
      { x: 4, y: -2, layer: "top", pointId: "B-right" },
    ],
  }
  const duplicateA: SimpleRouteConnection = {
    ...connectionA,
    __netConnectionName: "A-duplicate-net",
    pointsToConnect: connectionA.pointsToConnect.map((point, index) => ({
      ...point,
      pointId: `A-duplicate-${index}`,
      terminalVia: { toLayer: "bottom", viaDiameter: 0.9 },
    })),
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    connections: [
      connectionA,
      connectionB,
      {
        name: "C",
        pointsToConnect: [
          { x: 0, y: 1, layer: "bottom", pcb_port_id: "C-port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -2 },
        width: 2.4,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["B"],
        circuitJsonMetadata: { pcb_plated_hole_id: "B-through-pad" },
      },
      {
        type: "rect",
        center: { x: 0, y: 1 },
        width: 0.4,
        height: 0.4,
        layers: ["bottom"],
        connectedTo: ["C", "C-port"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "C-pad",
          pcb_port_id: "C-port",
        },
      },
    ],
  }
  const first: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    traceThickness: 0.1,
    viaDiameter: 0.4,
    route: [
      { x: -4, y: 0, z: 0 },
      { x: -2, y: 0, z: 0, traceThickness: 0.12 },
      { x: -2, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: -2, y: 0 }],
  }
  const second: HighDensityRoute = {
    ...first,
    route: [
      { x: 4, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 2, y: 0 }],
  }
  const other: HighDensityRoute = {
    connectionName: "B",
    rootConnectionName: "B",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: -2, z: 1 },
      {
        x: -1,
        y: -2,
        z: 1,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_plated_hole_id: "B-through-pad",
        },
      },
      { x: 1, y: -2, z: 0 },
      { x: 4, y: -2, z: 0 },
    ],
    vias: [],
  }
  const original = [first, other, second]
  const originalInput = structuredClone(original)
  const movedFirst: HighDensityRoute = {
    ...first,
    route: [...first.route.slice(0, -1), { ...first.route.at(-1)!, y: 1 }],
  }
  const movedSecond: HighDensityRoute = {
    ...second,
    route: [...second.route.slice(0, -1), { ...second.route.at(-1)!, y: 1 }],
  }
  const moved = [movedFirst, other, movedSecond]
  const options = {
    connections: [connectionA, connectionB, duplicateA],
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.18,
    connMap: new ConnectivityMap({
      A: ["A", "A-left", "A-right"],
      B: ["B", "B-left", "B-right"],
      C: ["C", "C-port"],
    }),
  }
  const immutable =
    createPipeline9ImmutableHdRoutesToSimplifiedPcbTracesConverter(options)
  const fresh = createPipeline7HdRoutesToSimplifiedPcbTracesConverter(options)
  const circuitOptions = {
    originalSrj: srj,
    includeOriginalConnections: true,
  }
  const preparedCircuitJson = createPreparedCircuitJsonConverter(
    srj,
    circuitOptions,
  )
  const baseline = immutable(original)
  expect(baseline.map((trace) => trace.pcb_trace_id)).toEqual([
    "A_0",
    "A_1",
    "B_0",
    "A_0",
    "A_1",
  ])
  expect(
    baseline[0]!.route.filter((part) => part.route_type === "via"),
  ).toEqual([
    {
      route_type: "via",
      x: -4,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.6,
      via_hole_diameter: 0.18,
    },
    {
      route_type: "via",
      x: -2,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.4,
      via_hole_diameter: 0.18,
    },
  ])
  expect(baseline[3]!.route[0]).toMatchObject({ via_diameter: 0.9 })
  expect(baseline[3]!.connectsTo).toEqual(["A-duplicate-0", "A-duplicate-1"])
  const throughPad = baseline[2]!.route.find(
    (part) => part.route_type === "through_obstacle",
  )
  expect(throughPad).toMatchObject({
    route_type: "through_obstacle",
    start: { x: -1, y: -2 },
    end: { x: 1, y: -2 },
    circuitJsonMetadata: { pcb_plated_hole_id: "B-through-pad" },
  })
  if (throughPad?.route_type !== "through_obstacle") {
    throw new Error("Immutable conversion fixture requires its pad span")
  }
  expect(throughPad.circuitJsonMetadata).not.toBe(
    other.route[1]!.toNextSegmentCircuitJsonMetadata,
  )
  const repeated = immutable([...original])
  expect(repeated).not.toBe(baseline)
  for (let index = 0; index < baseline.length; index++) {
    expect(repeated[index]).toBe(baseline[index])
  }
  const movedTraces = immutable(moved)
  expect(movedTraces[0]).not.toBe(baseline[0])
  expect(movedTraces[2]).toBe(baseline[2])
  const reordered = immutable([second, other, first])
  expect(reordered[0]!.route).toBe(baseline[1]!.route)
  expect(reordered[1]!.route).toBe(baseline[0]!.route)
  const duplicated = immutable([first, first, other, second])
  expect(duplicated[0]!.route).toBe(duplicated[1]!.route)

  for (const routes of [
    original,
    moved,
    [second, other, first],
    [second, other],
    [first, first, other, second],
    [],
    original,
  ]) {
    const actualTraces = immutable(routes)
    const expectedTraces = fresh(routes)
    expect(actualTraces).toEqual(expectedTraces)
    const actual = preparedCircuitJson(actualTraces)
    const expected = convertToCircuitJson(srj, expectedTraces, circuitOptions)
    expect(actual).toEqual(expected)
    expect(
      getDrcErrors(structuredClone(actual), {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      }),
    ).toEqual(
      getDrcErrors(structuredClone(expected), {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      }),
    )
    const source = actual.find(
      (element) =>
        element.type === "source_trace" && element.source_trace_id === "A",
    )
    if (source?.type !== "source_trace") {
      throw new Error("Immutable conversion fixture requires source A")
    }
    expect(source.connected_source_net_ids?.includes("C")).toBe(
      routes === moved,
    )
    source.connected_source_port_ids.push("mutated-output-only")
    for (const element of actual) {
      if (element.type === "pcb_trace") element.route.length = 0
      if (element.type === "pcb_via") element.hole_diameter = 99
    }
    expect(preparedCircuitJson(immutable(routes))).toEqual(expected)
  }
  expect(original).toEqual(originalInput)
  expect(immutable(original)).toEqual(baseline)
})

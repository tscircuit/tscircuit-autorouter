import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPreparedImmutableCircuitJsonConverter,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("immutable circuit snapshots borrow unchanged geometry but detach official checker inputs", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 1 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["C"],
        circuitJsonMetadata: { pcb_smtpad_id: "fixed-pad" },
      },
    ],
  }
  const first: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "A",
    connection_name: "A",
    route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const neighbour: SimplifiedPcbTrace = {
    ...first,
    pcb_trace_id: "B",
    connection_name: "B",
    route: [
      { route_type: "wire", x: -2, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 0,
        y: 1,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x: 0, y: 1, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 2, y: 1, layer: "bottom", width: 0.1 },
    ],
  }
  const moved: SimplifiedPcbTrace = {
    ...first,
    route: [first.route[0]!, { ...first.route[1]!, y: 0.2 }, first.route[2]!],
  }
  const originalInputs = structuredClone({ srj, first, neighbour, moved })
  const convert = createPreparedImmutableCircuitJsonConverter(srj)
  const original = convert([first, neighbour])
  const originalSnapshot = structuredClone(original)
  const originalTraces = original.filter(
    (element): element is PcbTrace => element.type === "pcb_trace",
  )
  const originalPad = original.find((element) => element.type === "pcb_smtpad")
  const originalPort = original.find((element) => element.type === "pcb_port")
  expect(originalPad).toBeDefined()
  expect(originalPort).toBeDefined()
  expect(original.filter((element) => element.type === "pcb_via")).toHaveLength(1)
  for (const candidate of [moved, first, moved, first]) {
    const routes = [candidate, neighbour]
    const snapshot = convert(routes)
    const traces = snapshot.filter(
      (element): element is PcbTrace => element.type === "pcb_trace",
    )
    expect(snapshot).toEqual(convertToCircuitJson(srj, routes))
    expect(traces[1]).toBe(originalTraces[1])
    expect(traces[1]!.route).toBe(originalTraces[1]!.route)
    expect(snapshot.find((element) => element.type === "pcb_smtpad")).toBe(
      originalPad,
    )
    expect(snapshot.find((element) => element.type === "pcb_port")).toBe(
      originalPort,
    )
    if (candidate === first) expect(traces[0]).toBe(originalTraces[0])
    else expect(traces[0]).not.toBe(originalTraces[0])

    // This is the evaluator's checker boundary: only mutable trace points are
    // copied. Endpoint inference cannot alter borrowed neighbours or inputs.
    const checkerInput = snapshot.map(
      (element): AnyCircuitElement =>
        element.type === "pcb_trace"
          ? {
              ...element,
              route: element.route.map((point) => ({ ...point })),
            }
          : element,
    )
    const options = { includeTraceContinuity: false, includeBoardEdge: false }
    expect(getDrcErrors(checkerInput, options)).toEqual(
      getDrcErrors(convertToCircuitJson(srj, routes), options),
    )
    expect(original).toEqual(originalSnapshot)
    expect(convert(routes)).toEqual(convertToCircuitJson(srj, routes))
  }

  // HD callers use index-derived identities, so moving an immutable object to
  // a different array index must rebuild its trace identity, not reuse the old.
  const hdRoutes: HighDensityRoute[] = [0, 1].map(
    (y): HighDensityRoute => ({
      connectionName: y === 0 ? "A" : "B",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-2, 2].map((x) => ({ x, y, z: 0 })),
      vias: [],
    }),
  )
  const hdConvert = createPreparedImmutableCircuitJsonConverter(srj)
  const hdOriginal = hdConvert(hdRoutes)
  const hdCopy = structuredClone(hdOriginal)
  for (const routes of [hdRoutes, [...hdRoutes].reverse(), hdRoutes]) {
    expect(hdConvert(routes)).toEqual(convertToCircuitJson(srj, routes))
    expect(hdOriginal).toEqual(hdCopy)
  }
  expect({ srj, first, neighbour, moved }).toEqual(originalInputs)
})

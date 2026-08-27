import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createRadialGridOffsets,
  getCheckedViaInPadIdentities,
  getPolicyAllowedLiftLayers,
  getSrjObstacleClearanceErrors,
  getViaBoardEdgeErrors,
  getViaPadClearanceErrors,
  hasPreservedSameNetJunctions,
  hasPreservedTraceStructure,
  isStrictErrorIdentitySubset,
  isTraceMutationAllowedByRoutingPolicy,
  liftLocalTraceWindow,
  relocateViaVertex,
  translateLocalTraceVertices,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const makeTrace = (route: SimplifiedPcbTrace["route"]): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: "trace_a",
  connection_name: "connection_a",
  connectsTo: ["port_a", "port_b"],
  route,
})

test("post-power DRC repair primitives preserve identities and topology", (): void => {
  expect(isStrictErrorIdentitySubset(["a", "b"], ["a"])).toBe(true)
  expect(isStrictErrorIdentitySubset(["a", "b"], ["c"])).toBe(false)
  expect(isStrictErrorIdentitySubset(["a", "b"], ["a", "b"])).toBe(false)
  const cappedRadialOffsets = createRadialGridOffsets({
    minDistance: 0.2,
    maxDistance: 2,
    step: 0.05,
    maxCandidates: 80,
  })
  expect(cappedRadialOffsets).toHaveLength(80)
  expect(
    Math.max(...cappedRadialOffsets.map((offset) => offset.distance)),
  ).toBeGreaterThanOrEqual(1.99)

  {
    const trace = makeTrace([
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.12,
        layer: "top",
        start_pcb_port_id: "port_a",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.12, layer: "top" },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
      },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "bottom" },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.2,
        layer: "bottom",
        end_pcb_port_id: "port_b",
      },
    ])
    const candidate = relocateViaVertex(trace, 2, { dx: 0.2, dy: -0.1 })!
    expect(
      candidate.route
        .slice(1, 4)
        .map((point) =>
          "x" in point ? { x: point.x, y: point.y } : undefined,
        ),
    ).toEqual([
      { x: 1.2, y: -0.1 },
      { x: 1.2, y: -0.1 },
      { x: 1.2, y: -0.1 },
    ])
    expect(candidate.route[1]).toMatchObject({ width: 0.12 })
    expect(candidate.route[2]).toMatchObject({ via_diameter: 0.4 })
    expect(candidate.route[3]).toMatchObject({ width: 0.2 })
    expect(hasPreservedTraceStructure(trace, candidate)).toBe(true)
  }

  {
    const trace = makeTrace([
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.13,
        layer: "top",
        start_pcb_port_id: "port_a",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.13, layer: "top" },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.19, layer: "inner1" },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.19,
        layer: "inner1",
        end_pcb_port_id: "port_b",
      },
    ])
    const candidate = translateLocalTraceVertices({
      trace,
      center: { x: 1, y: 0 },
      selectionRadius: 0.01,
      dx: -0.2,
      dy: 0.25,
    })!
    expect(
      candidate.route
        .slice(1, 4)
        .map((point) =>
          "x" in point ? { x: point.x, y: point.y } : undefined,
        ),
    ).toEqual([
      { x: 0.8, y: 0.25 },
      { x: 0.8, y: 0.25 },
      { x: 0.8, y: 0.25 },
    ])
    expect(hasPreservedTraceStructure(trace, candidate)).toBe(true)
  }

  {
    const trace = makeTrace(
      Array.from({ length: 8 }, (_, index) => ({
        route_type: "wire" as const,
        x: index,
        y: 0,
        width: index % 2 === 0 ? 0.12 : 0.2,
        layer: "top",
        ...(index === 0 ? { start_pcb_port_id: "port_a" } : {}),
        ...(index === 7 ? { end_pcb_port_id: "port_b" } : {}),
      })),
    )
    const candidate = liftLocalTraceWindow({
      trace,
      center: { x: 3.5, y: 0 },
      padding: 2,
      targetLayer: "inner1",
    })!
    expect(
      candidate.route.filter((point) => point.route_type === "via"),
    ).toHaveLength(2)
    expect(
      candidate.route
        .filter((point) => point.route_type === "wire")
        .some((point) => point.layer === "inner1" && point.width === 0.2),
    ).toBe(true)
    expect(hasPreservedTraceStructure(trace, candidate)).toBe(true)

    const disconnected = structuredClone(candidate)
    const firstVia = disconnected.route.find(
      (point) => point.route_type === "via",
    )
    if (firstVia?.route_type === "via") firstVia.x += 0.01
    expect(hasPreservedTraceStructure(trace, disconnected)).toBe(false)
  }

  {
    const trace = makeTrace([
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.15,
        layer: "top",
      },
      {
        route_type: "wire",
        x: 1,
        y: 0,
        width: 0.15,
        layer: "top",
      },
    ])
    const srj = {
      layerCount: 4,
      minTraceWidth: 0.15,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [],
      obstacles: [],
      buses: [
        {
          busId: "bus_a",
          connectionNames: ["connection_a"],
          allowedLayers: ["top", "inner2"],
        },
      ],
    } satisfies SimpleRouteJson
    const connectivityMap = new ConnectivityMap({})
    expect(getPolicyAllowedLiftLayers({ trace, srj, connectivityMap })).toEqual(
      ["top", "inner2"],
    )
    expect(
      getPolicyAllowedLiftLayers({
        trace,
        srj: {
          ...srj,
          differentialPairs: [
            {
              connectionNames: ["connection_a", "connection_b"],
              lengthTolerance: 0.1,
            },
          ],
        },
        connectivityMap,
      }),
    ).toEqual([])
    const skewSrj = {
      ...srj,
      buses: [
        {
          busId: "length_matched_bus",
          connectionNames: ["connection_a"],
          maxLengthSkew: 0.1,
          allowedLayers: ["top", "inner2"],
        },
      ],
    } satisfies SimpleRouteJson
    expect(
      getPolicyAllowedLiftLayers({ trace, srj: skewSrj, connectivityMap }),
    ).toEqual([])
    expect(
      isTraceMutationAllowedByRoutingPolicy({
        trace,
        srj: skewSrj,
        connectivityMap,
      }),
    ).toBe(false)
    const throughObstacleTrace: SimplifiedPcbTrace = {
      ...trace,
      route: [
        trace.route[0]!,
        {
          route_type: "through_obstacle",
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          from_layer: "top",
          to_layer: "top",
          width: 0.15,
        },
        trace.route[1]!,
      ],
    }
    expect(
      isTraceMutationAllowedByRoutingPolicy({
        trace: throughObstacleTrace,
        srj,
        connectivityMap,
      }),
    ).toBe(false)
  }

  {
    const edgeTrace = makeTrace([
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1.9, y: 0, width: 0.15, layer: "top" },
      {
        route_type: "via",
        x: 1.9,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
      { route_type: "wire", x: 1.9, y: 0, width: 0.15, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "bottom" },
    ])
    const srj = {
      layerCount: 4,
      minTraceWidth: 0.15,
      minBoardEdgeClearance: 0.1,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [],
      obstacles: [],
    } satisfies SimpleRouteJson
    expect(getViaBoardEdgeErrors({ traces: [edgeTrace], srj })).toHaveLength(1)
    expect(
      getViaBoardEdgeErrors({
        traces: [relocateViaVertex(edgeTrace, 2, { dx: -0.5, dy: 0 })!],
        srj,
      }),
    ).toHaveLength(0)
  }

  {
    const connectivityMap = new ConnectivityMap({})
    connectivityMap.addConnections([["trace_a", "trace_branch"]])
    const before = makeTrace([
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
    ])
    const branch: SimplifiedPcbTrace = {
      ...makeTrace([
        { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 1, y: 1, width: 0.15, layer: "top" },
      ]),
      pcb_trace_id: "trace_branch",
    }
    const disconnected = translateLocalTraceVertices({
      trace: before,
      center: { x: 1, y: 0 },
      selectionRadius: 0.01,
      dx: 0,
      dy: 0.2,
    })!
    expect(
      hasPreservedSameNetJunctions({
        before,
        candidate: disconnected,
        otherTraces: [branch],
        connectivityMap,
        layerCount: 4,
      }),
    ).toBe(false)
  }

  {
    const srj = {
      layerCount: 4,
      minTraceWidth: 0.15,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [
        {
          name: "pad_net",
          pointsToConnect: [
            {
              x: 0,
              y: 0,
              layers: ["top", "bottom"],
              pcb_port_id: "pad_port",
            },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top", "bottom"],
          center: { x: 0, y: 0 },
          width: 0.8,
          height: 0.8,
          connectedTo: ["pad_net", "pad_port"],
          circuitJsonMetadata: {
            pcb_plated_hole_id: "actual_plated_hole",
            pcb_port_id: "pad_port",
          },
        },
      ],
    } satisfies SimpleRouteJson
    const circuitJson = [
      {
        type: "pcb_via",
        pcb_via_id: "via_actual",
        pcb_trace_id: "trace_a",
        x: 0,
        y: 0,
        outer_diameter: 0.3,
        hole_diameter: 0.2,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: "actual_plated_hole",
        shape: "circle",
        outer_diameter: 0.8,
        hole_diameter: 0.4,
        x: 0,
        y: 0,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "synthetic_component_obstacle",
        shape: "rect",
        width: 2,
        height: 2,
        x: 0,
        y: 0,
        layer: "top",
      },
    ] as AnyCircuitElement[]
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toEqual([
      "trace_a:0.000000:0.000000:top-bottom:actual_plated_hole",
    ])
    expect(
      getViaPadClearanceErrors({
        circuitJson,
        srj,
        supplementalConnMap: new ConnectivityMap({}),
      }),
    ).toHaveLength(1)
    const connectedViaPadMap = new ConnectivityMap({})
    connectedViaPadMap.addConnections([["via_actual", "actual_plated_hole"]])
    expect(
      getViaPadClearanceErrors({
        circuitJson,
        srj,
        supplementalConnMap: connectedViaPadMap,
      }),
    ).toHaveLength(0)
  }

  {
    const keepoutSrj = {
      layerCount: 4,
      minTraceWidth: 0.15,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.5,
          height: 0.5,
          connectedTo: [],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          connectedTo: ["plane"],
          isCopperPour: true,
        },
      ],
    } satisfies SimpleRouteJson
    const crossingTrace = makeTrace([
      { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
    ])
    expect(
      getSrjObstacleClearanceErrors({
        traces: [crossingTrace],
        srj: keepoutSrj,
        connectivityMap: new ConnectivityMap({}),
      }),
    ).toHaveLength(1)
  }
})

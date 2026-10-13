import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { reserveRetainedCopperPorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/reserveRetainedCopperPorts"
import {
  hasPreloadedTraceSectionMetadata,
  type PreloadedTraceConnectionMetadata,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

type Port = { id: string; x: number; y: number; z: number }
type PreloadedSerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number] &
  Pick<PreloadedTraceConnectionMetadata, "preloadedTraceSection">

const createGraph = (ports: Port[], netId: string): SerializedHyperGraph => {
  const representedWire: PreloadedSerializedConnection = {
    connectionId: "represented-wire",
    mutuallyConnectedNetworkId: netId,
    startRegionId: "own-start",
    endRegionId: "own-end",
    preloadedTraceSection: {
      traceId: "original-wire",
      startRoutePosition: 0.2,
      endRoutePosition: 0.8,
      startPoint: { x: 2, y: 0, z: 0 },
      endPoint: { x: 8, y: 0, z: 0 },
    },
  }
  return {
    regions: [
      ...["own-start", "own-end", "foreign-start", "foreign-end"].map(
        (regionId): SerializedHyperGraph["regions"][number] => ({
          regionId,
          pointIds: [`${regionId}-port`],
          d: { center: { x: 5, y: 0 }, width: 30, height: 10 },
        }),
      ),
      ...["left", "right"].map(
        (regionId): SerializedHyperGraph["regions"][number] => ({
          regionId,
          pointIds: [
            ...ports.map((port): string => port.id),
            ...(regionId === "left"
              ? ["own-start-port", "foreign-start-port"]
              : ["own-end-port", "foreign-end-port"]),
          ],
          d: {
            center: { x: 5, y: 0 },
            width: 30,
            height: 10,
            availableZ: [0, 1, 2, 3],
          },
        }),
      ),
    ],
    ports: [
      ...ports.map((port): SerializedHyperGraph["ports"][number] => ({
        portId: port.id,
        region1Id: "left",
        region2Id: "right",
        d: { x: port.x, y: port.y, z: port.z },
      })),
      ...[
        { id: "own-start", x: 2, y: 0, start: true },
        { id: "own-end", x: 8, y: 0, start: false },
        { id: "foreign-start", x: -1, y: 1, start: true },
        { id: "foreign-end", x: 12, y: 1, start: false },
      ].map((terminal): SerializedHyperGraph["ports"][number] => ({
        portId: `${terminal.id}-port`,
        region1Id: terminal.start ? terminal.id : "right",
        region2Id: terminal.start ? "left" : terminal.id,
        d: { x: terminal.x, y: terminal.y, z: 0 },
      })),
    ],
    connections: [
      representedWire,
      {
        connectionId: "foreign-wire",
        mutuallyConnectedNetworkId: "foreign-net",
        startRegionId: "foreign-start",
        endRegionId: "foreign-end",
      },
    ],
  }
}

test("retained copper respects port clearance and editable spans", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 25, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "original-wire",
        connection_name: "wire-net",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.15 },
          { route_type: "wire", x: 10, y: 0, layer: "top", width: 0.3 },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "original-via",
        connection_name: "via-net",
        route: [
          { route_type: "wire", x: 19, y: 1, layer: "top", width: 0.15 },
          {
            route_type: "via",
            x: 20,
            y: 0,
            from_layer: "top",
            to_layer: "inner1",
            layers: ["top", "inner1"],
            via_diameter: 0.45,
            via_hole_diameter: 0.3,
          },
          { route_type: "wire", x: 21, y: 1, layer: "inner1", width: 0.15 },
        ],
      },
    ],
  }
  const original = structuredClone(srj)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const wireNet = connMap.getNetConnectedToId("wire-net")!
  const viaNet = connMap.getNetConnectedToId("via-net")!
  const graph = createGraph(
    [
      { id: "tail-overlap", x: 1.8317, y: 0.114, z: 0 },
      { id: "editable-body", x: 5, y: 0, z: 0 },
      { id: "body-near-cut", x: 2.2, y: 0, z: 0 },
      { id: "retained-cut", x: 2, y: 0, z: 0 },
      { id: "other-layer", x: 1, y: 0, z: 3 },
      { id: "spacing-only", x: 1, y: 0.2, z: 0 },
      { id: "start-width", x: 1, y: 0.16, z: 0 },
      { id: "beyond-clearance", x: 1, y: 0.31, z: 0 },
      { id: "annulus", x: 20.2, y: 0, z: 3 },
      { id: "inside-drill", x: 20, y: 0, z: 3 },
      { id: "outside-barrel", x: 20.4, y: 0, z: 3 },
    ],
    wireNet,
  )
  const source = {
    srj,
    connMap,
    traceWidth: srj.minTraceWidth,
    copperClearance: 0,
  }
  expect(reserveRetainedCopperPorts(graph, source)).toBe(5)
  const reservations = (id: string): unknown =>
    graph.ports.find((port): boolean => port.portId === id)!.d
      ?.immutableCopperNetIds
  expect(reservations("tail-overlap")).toEqual([wireNet])
  expect(reservations("retained-cut")).toEqual([wireNet])
  for (const id of [
    "editable-body",
    "body-near-cut",
    "other-layer",
    "spacing-only",
    "start-width",
    "beyond-clearance",
  ]) {
    expect(reservations(id)).toBeUndefined()
  }
  expect(reservations("annulus")).toEqual([viaNet])
  // Copper admission does not authorize traversing the mechanical drill hole.
  expect(reservations("inside-drill")).toBeUndefined()
  expect(reservations("outside-barrel")).toBeUndefined()
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  expect(loaded.topology.portReservedNetId?.[0]).toBe(
    loaded.problem.routeNet[0],
  )
  expect(loaded.topology.portReservedNetId?.[0]).not.toBe(
    loaded.problem.routeNet[1],
  )
  expect(solver.problemSetup.portEndpointReservationNetId[0]).toBe(
    loaded.problem.routeNet[0],
  )
  const first = structuredClone(graph)
  expect(reserveRetainedCopperPorts(graph, source)).toBe(5)
  expect(graph).toEqual(first)
  const spaced = structuredClone(graph)
  reserveRetainedCopperPorts(spaced, { ...source, copperClearance: 0.15 })
  expect(
    spaced.ports.find((port): boolean => port.portId === "spacing-only")!.d
      .immutableCopperNetIds,
  ).toEqual([wireNet])
  for (const id of ["editable-body", "other-layer", "beyond-clearance"]) {
    expect(
      spaced.ports.find((port): boolean => port.portId === id)!.d
        .immutableCopperNetIds,
    ).toBeUndefined()
  }

  // Offset both boundaries of the annulus. A sufficiently large drill void
  // remains copper-clear, while points near either rim violate the gap.
  const largeVoid = structuredClone(srj)
  const annulusVia = largeVoid.traces![1]!.route[1]!
  if (annulusVia.route_type !== "via") {
    throw new Error("Expected the original annulus fixture")
  }
  annulusVia.via_diameter = 1
  annulusVia.via_hole_diameter = 0.8
  const annulus = createGraph(
    [
      { id: "drill-void", x: 20, y: 0, z: 3 },
      { id: "inner-rim-spacing", x: 20.2, y: 0, z: 3 },
      { id: "outer-rim-spacing", x: 20.65, y: 0, z: 3 },
      { id: "outside-clearance", x: 20.8, y: 0, z: 3 },
    ],
    wireNet,
  )
  reserveRetainedCopperPorts(annulus, {
    ...source,
    srj: largeVoid,
    copperClearance: 0.15,
  })
  expect(annulus.ports[0]!.d.immutableCopperNetIds).toBeUndefined()
  expect(annulus.ports[1]!.d.immutableCopperNetIds).toEqual([viaNet])
  expect(annulus.ports[2]!.d.immutableCopperNetIds).toEqual([viaNet])
  expect(annulus.ports[3]!.d.immutableCopperNetIds).toBeUndefined()

  // A shifted duplicate must drop this helper's stale contact, retaining an
  // externally supplied reservation and the original graph coordinates.
  const duplicate = structuredClone(graph.ports[0]!)
  duplicate.portId = "shifted-duplicate"
  duplicate.d.x = 5
  duplicate.d.immutableCopperNetIds.push("supplied-net")
  graph.ports.push(duplicate)
  reserveRetainedCopperPorts(graph, source)
  expect(reservations("shifted-duplicate")).toEqual(["supplied-net"])
  expect(graph.ports[0]!.d.x).toBe(first.ports[0]!.d.x)

  const blindGraph = createGraph(
    [{ id: "bottom", x: 20.2, y: 0, z: 3 }],
    wireNet,
  )
  reserveRetainedCopperPorts(blindGraph, {
    ...source,
    srj: { ...srj, allowBlindAndBuriedVias: true },
  })
  expect(blindGraph.ports[0]!.d.immutableCopperNetIds).toBeUndefined()
  const editableVia = createGraph(
    [{ id: "via", x: 20.2, y: 0, z: 3 }],
    wireNet,
  )
  const representedVia: PreloadedSerializedConnection = {
    connectionId: "represented-via",
    mutuallyConnectedNetworkId: viaNet,
    startRegionId: "left",
    endRegionId: "right",
    preloadedTraceSection: {
      traceId: "original-via",
      startRoutePosition: 0,
      endRoutePosition: 2,
      startPoint: { x: 19, y: 1, z: 0 },
      endPoint: { x: 21, y: 1, z: 1 },
    },
  }
  editableVia.connections!.push(representedVia)
  reserveRetainedCopperPorts(editableVia, source)
  expect(editableVia.ports[0]!.d.immutableCopperNetIds).toBeUndefined()
  const boundaryVia = structuredClone(editableVia)
  const viaOwner = boundaryVia.connections![2]!
  if (!hasPreloadedTraceSectionMetadata(viaOwner)) {
    throw new Error("Expected the represented via fixture metadata")
  }
  viaOwner.preloadedTraceSection.startRoutePosition = 1
  reserveRetainedCopperPorts(boundaryVia, source)
  expect(boundaryVia.ports[0]!.d.immutableCopperNetIds).toEqual([viaNet])
  const invalidSpan = structuredClone(srj)
  const invalidVia = invalidSpan.traces![1]!.route[1]!
  if (invalidVia.route_type !== "via") {
    throw new Error("Expected the original via fixture")
  }
  invalidVia.to_layer = "inner2"
  invalidVia.layers = ["top", "inner2"]
  expect(
    (): number =>
      reserveRetainedCopperPorts(graph, {
        ...source,
        srj: { ...invalidSpan, allowBlindAndBuriedVias: true },
      }),
  ).toThrow("invalid physical span")
  expect(srj).toEqual(original)

  const badOwner = structuredClone(graph)
  const missingOwner = badOwner.connections![0]!
  if (!hasPreloadedTraceSectionMetadata(missingOwner)) {
    throw new Error("Expected the represented owner fixture metadata")
  }
  missingOwner.preloadedTraceSection.traceId = "missing"
  expect((): number => reserveRetainedCopperPorts(badOwner, source)).toThrow(
    "has no trace",
  )
  const badBounds = structuredClone(graph)
  const invalidOwner = badBounds.connections![0]!
  if (!hasPreloadedTraceSectionMetadata(invalidOwner)) {
    throw new Error("Expected the represented bounds fixture metadata")
  }
  invalidOwner.preloadedTraceSection.endRoutePosition = 2
  expect((): number => reserveRetainedCopperPorts(badBounds, source)).toThrow(
    "is invalid",
  )
  expect(
    (): number =>
      reserveRetainedCopperPorts(graph, {
        ...source,
        traceWidth: Number.NaN,
      }),
  ).toThrow("positive wire width")
  expect(
    (): number =>
      reserveRetainedCopperPorts(graph, {
        ...source,
        copperClearance: -0.1,
      }),
  ).toThrow("finite and nonnegative")
  const emptyGraph = createGraph([], wireNet)
  const emptyBefore = structuredClone(emptyGraph)
  expect(
    reserveRetainedCopperPorts(emptyGraph, {
      ...source,
      srj: { ...srj, traces: [] },
    }),
  ).toBe(0)
  expect(emptyGraph).toEqual(emptyBefore)
})

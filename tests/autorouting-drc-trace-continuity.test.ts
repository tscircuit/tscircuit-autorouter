import { expect, test } from "bun:test"
import {
  checkEachPcbTraceNonOverlapping,
  checkTracesAreContiguous,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotateTraceEndpointPorts"

const createTrace = (
  id: string,
  points: Array<{ x: number; y: number }>,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: "net",
  route: points.map((point) => ({
    ...point,
    route_type: "wire",
    layer: "top",
    width: 0.1,
  })),
})

test("autorouting continuity matches checks for endpoints, siblings, pad boundaries and vias", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 6, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_a", "pcb_port_a"],
      },
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: ["pcb_plated_hole_b", "pcb_port_b"],
      },
    ],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
  }
  const goodTrace = createTrace("good", [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
  ])
  const missingTrace = createTrace("missing", [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ])
  const viaTrace: SimplifiedPcbTrace = {
    ...goodTrace,
    pcb_trace_id: "misaligned",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 2.02,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
      },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const traceCases = [
    [goodTrace],
    [missingTrace],
    [viaTrace],
    [
      createTrace("branch_a", [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
      createTrace("branch_b", [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
      ]),
    ],
  ]
  const circuits = traceCases.map((traces) => convertToCircuitJson(srj, traces))
  const rotatedSrj = structuredClone(srj)
  for (const obstacle of rotatedSrj.obstacles) {
    obstacle.width = 2
    obstacle.height = 0.5
    obstacle.ccwRotationDegrees = 45
  }
  const rotatedBoundaryTrace = createTrace("boundary", [
    { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: 4 + Math.SQRT1_2, y: Math.SQRT1_2 },
  ])
  circuits.push(convertToCircuitJson(rotatedSrj, [rotatedBoundaryTrace]))
  circuits.push(
    convertToCircuitJson(rotatedSrj, [
      createTrace("outside_rotated_pad", [
        { x: 0, y: 0.8 },
        { x: 4, y: 0.8 },
      ]),
    ]),
  )
  circuits.push([
    {
      type: "pcb_trace",
      pcb_trace_id: "unconnected",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ] as AnyCircuitElement[])
  circuits.push([
    {
      type: "pcb_trace",
      pcb_trace_id: "closed",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ] as AnyCircuitElement[])

  const errorCounts: number[] = []
  for (const circuitJson of circuits) {
    const expected = checkTracesAreContiguous(circuitJson)
    expect<unknown>(checkTraceContinuity(circuitJson)).toEqual(expected)
    errorCounts.push(expected.length)
  }
  // A via connects the incoming/outgoing copper on its declared layers even
  // when the wire endpoints do not duplicate the via center.
  expect(errorCounts).toEqual([0, 1, 0, 0, 0, 2, 2, 1])

  const edgeSrj = structuredClone(srj)
  edgeSrj.obstacles[1]!.layers = ["top"]
  edgeSrj.obstacles[1]!.connectedTo = ["pcb_smtpad_b", "pcb_port_b"]
  const edgeCircuit = convertToCircuitJson(edgeSrj, [
    createTrace("edge_a", [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]),
    createTrace("edge_b", [
      { x: 2, y: 0 },
      { x: 3.46, y: 0 },
    ]),
  ])
  const referenceEdgeCircuit = structuredClone(edgeCircuit)
  // Reference overlap checking adds endpoint ids before continuity runs.
  checkEachPcbTraceNonOverlapping(referenceEdgeCircuit)
  expect(checkTraceContinuity(edgeCircuit)).toHaveLength(1)
  annotateTraceEndpointPorts(edgeCircuit)
  expect(edgeCircuit).toEqual(referenceEdgeCircuit)
  expect(checkTraceContinuity(edgeCircuit)).toHaveLength(1)
  expect<unknown>(checkTraceContinuity(edgeCircuit)).toEqual(
    checkTracesAreContiguous(referenceEdgeCircuit),
  )

  const detachedTrace = createTrace("detached", [
    { x: 0.8, y: 0 },
    { x: 3, y: 0 },
  ])
  if (detachedTrace.route[0]?.route_type !== "wire")
    throw new Error("Expected a wire endpoint")
  detachedTrace.route[0].start_pcb_port_id = "pcb_port_b"
  const detachedCircuit = convertToCircuitJson(srj, [detachedTrace])
  const referenceDetachedCircuit = structuredClone(detachedCircuit)
  checkEachPcbTraceNonOverlapping(referenceDetachedCircuit)
  annotateTraceEndpointPorts(detachedCircuit)
  expect(detachedCircuit).toEqual(referenceDetachedCircuit)
  const detachedErrors = checkTraceContinuity(detachedCircuit)
  expect<unknown>(detachedErrors).toEqual(
    checkTracesAreContiguous(referenceDetachedCircuit),
  )
  expect(detachedErrors).toHaveLength(2)
  expect(detachedErrors[1]!.center).toEqual({ x: 0.8, y: 0 })
})

import { expect, test } from "bun:test"
import {
  checkEachPcbTraceNonOverlapping,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { createPreparedViaTraceClearanceChecker } from "lib/testing/utils/createPreparedViaTraceClearanceChecker"

test("prepared via-trace partitions preserve complete official errors, names and order", (): void => {
  const signal: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    source_trace_id: "signal-net",
    route: [
      {
        route_type: "wire",
        x: -1,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "port-start",
      },
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
      {
        route_type: "wire",
        x: 1,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "port-end",
      },
    ],
  }
  const contact: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "contact",
    source_trace_id: "contact-net",
    // Initial clearance is followed by contact elsewhere on the same pair.
    // Its typed error must be suppressed, not retained from a clipped segment.
    route: [
      { x: -1, y: 0.53 },
      { x: 1, y: 0.53 },
      { x: 1, y: 0.28 },
      { x: -1, y: 0.28 },
    ].map((point) => ({
      ...point,
      route_type: "wire" as const,
      width: 0.1,
      layer: "top" as const,
    })),
  }
  const bottom: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "bottom",
    source_trace_id: "bottom-net",
    route: [-1, 1].map((x) => ({
      route_type: "wire" as const,
      x,
      y: 0,
      width: 0.1,
      layer: "bottom" as const,
    })),
  }
  const owner: PcbTrace = {
    ...signal,
    pcb_trace_id: "owner",
    source_trace_id: "via-net",
    route: signal.route.map((point): PcbTrace["route"][number] => {
      if (point.route_type !== "wire") {
        throw new Error("The fixture's distant owner requires wire geometry")
      }
      return { ...point, x: point.x + 100, y: 100 }
    }),
  }
  const distant: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "distant",
    source_trace_id: "distant-net",
    route: Array.from({ length: 40 }, (_, index) => ({
      route_type: "wire" as const,
      x: index,
      y: 30,
      width: 0.1,
      layer: "top" as const,
    })),
  }
  const vias: PcbVia[] = [
    { pcb_via_id: "viaA", x: -0.5, y: 0.28, layers: ["top"] },
    { pcb_via_id: "viaB", x: 0.5, y: 0.28, layers: ["top"] },
    { pcb_via_id: "viaBottom", x: 0, y: 0.28, layers: ["bottom"] },
    { pcb_via_id: "viaFar", x: 1000, y: 1000, layers: ["top", "bottom"] },
  ].map((via) => ({
    type: "pcb_via",
    pcb_trace_id: "owner",
    hole_diameter: 0.1,
    outer_diameter: 0.3,
    ...via,
  })) as PcbVia[]
  const metadata = [
    {
      type: "source_component",
      source_component_id: "component-source",
      name: "U1",
    },
    {
      type: "pcb_component",
      pcb_component_id: "component",
      source_component_id: "component-source",
    },
    ...["start", "end"].flatMap((name, index) => [
      {
        type: "source_port",
        source_port_id: `source-${name}`,
        port_hints: [String(index + 1), name],
      },
      {
        type: "pcb_port",
        pcb_port_id: `port-${name}`,
        source_port_id: `source-${name}`,
        pcb_component_id: "component",
        x: index === 0 ? -1 : 1,
        y: 0,
        layers: ["top"],
      },
    ]),
    {
      type: "source_trace",
      source_trace_id: "signal-net",
      connected_source_port_ids: ["source-start", "source-end"],
      connected_source_net_ids: [],
    },
  ] as unknown as AnyCircuitElement[]
  const board: AnyCircuitElement[] = [
    ...metadata,
    signal,
    vias[0]!,
    owner,
    vias[1]!,
    contact,
    bottom,
    vias[2]!,
    distant,
    vias[3]!,
    { type: "pcb_trace", pcb_trace_id: "empty", route: [] },
  ]
  const prepared = createPreparedViaTraceClearanceChecker()
  const compareWithNative = (
    input: AnyCircuitElement[],
  ): ReturnType<typeof checkViaTraceClearance> => {
    const originalInput = structuredClone(input)
    const connMap = getFullConnectivityMapFromCircuitJson(input)
    connMap.addConnections(vias.map((via) => [via.pcb_via_id, "owner"]))
    const originalMap = structuredClone({
      netMap: connMap.netMap,
      idToNetMap: connMap.idToNetMap,
    })
    const options = { connMap, minClearance: 0.1 }
    const before = prepared.getStats()
    const expected = checkViaTraceClearance(input, options)
    const actual = prepared(input, options)
    expect(actual).toEqual(expected)
    expect(prepared.getStats().partitionedEvaluationCount).toBe(
      before.partitionedEvaluationCount + 1,
    )
    expect(input).toEqual(originalInput)
    expect({ netMap: connMap.netMap, idToNetMap: connMap.idToNetMap }).toEqual(
      originalMap,
    )
    return actual
  }
  const baseline = compareWithNative(board)
  expect(baseline.map((error) => [error.pcb_via_id, error.pcb_trace_id])).toEqual([
    ["viaA", "signal"],
    ["viaB", "signal"],
    ["viaBottom", "bottom"],
  ])
  expect(baseline[0]!.message).toContain("U1")
  expect(baseline[0]!.center).toEqual({ x: 0, y: 0 })

  // The via's distant owner is omitted geometrically. Native via names do not
  // recursively read that owner's trace endpoints or its naming metadata.
  const renamedOwner = board.map((element): AnyCircuitElement => {
    if (element !== owner) return element
    return {
      ...owner,
      route: owner.route.map((point) => ({
        ...point,
        start_pcb_port_id: "other-start",
        end_pcb_port_id: "other-end",
      })),
    }
  })
  expect(compareWithNative(renamedOwner)).toEqual(baseline)
  const shadow = {
    type: "source_component",
    source_component_id: "viaA",
    name: "shadow-via",
  } as AnyCircuitElement
  const shadowed = compareWithNative([shadow, ...board])
  expect(shadowed[0]!.message).toContain("shadow-via")
  expect(compareWithNative([...board, shadow])).toEqual(baseline)
  const sourceShadow = {
    type: "source_trace",
    source_trace_id: "viaB",
    connected_source_port_ids: [],
    connected_source_net_ids: [],
  } as AnyCircuitElement
  const portShadow = {
    type: "pcb_port",
    pcb_port_id: "signal",
    source_port_id: "source-start",
    pcb_component_id: "component",
    x: 40,
    y: 40,
    layers: ["top"],
  } as AnyCircuitElement
  compareWithNative([sourceShadow, portShadow, ...board])
  compareWithNative([...board].reverse())
  const inferred = structuredClone(board)
  const inferredSignal = inferred.find(
    (element): element is PcbTrace =>
      element.type === "pcb_trace" && element.pcb_trace_id === "signal",
  )!
  const firstPoint = inferredSignal.route[0]!
  const lastPoint = inferredSignal.route.at(-1)!
  if (firstPoint.route_type !== "wire" || lastPoint.route_type !== "wire") {
    throw new Error("The fixture requires wire endpoints for native inference")
  }
  delete firstPoint.start_pcb_port_id
  delete lastPoint.end_pcb_port_id
  checkEachPcbTraceNonOverlapping(inferred, { minClearance: 0.1 })
  compareWithNative(inferred)
  expect(prepared.getStats().selectedViaTracePairCount).toBeLessThan(
    prepared.getStats().totalViaTracePairCount,
  )
  expect(prepared.getStats().selectedViaSegmentPairCount).toBeLessThan(
    prepared.getStats().totalViaSegmentPairCount,
  )
  expect(prepared.getStats().nativeInvocationCount).toBeGreaterThan(0)
})

import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbBoard,
  PcbComponent,
  PcbPort,
  PcbSmtPad,
  PcbTrace,
  SourcePort,
  SourceSimpleChip,
} from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad-trace cache invalidates exact metadata, order, connectivity and options with detached results", (): void => {
  const sourceComponent: SourceSimpleChip = {
    type: "source_component",
    ftype: "simple_chip",
    source_component_id: "source-component",
    name: "U1",
  }
  const component: PcbComponent = {
    type: "pcb_component",
    pcb_component_id: "component",
    source_component_id: "source-component",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layer: "top",
    rotation: 0,
    obstructs_within_bounds: true,
  }
  const sourcePorts: SourcePort[] = ["start", "end"].map(
    (name, index): SourcePort => ({
      type: "source_port",
      source_port_id: `source-${name}`,
      source_component_id: "source-component",
      name,
      port_hints: [String(index + 1), name],
    }),
  )
  const ports: PcbPort[] = ["start", "end"].map(
    (name, index): PcbPort => ({
      type: "pcb_port",
      pcb_port_id: `port-${name}`,
      source_port_id: `source-${name}`,
      pcb_component_id: "component",
      x: index === 0 ? -1 : 1,
      y: 0.32,
      layers: ["top"],
    }),
  )
  const boardElement: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    thickness: 1.6,
    num_layers: 2,
    material: "fr4",
    min_trace_to_pad_edge_clearance: 0.2,
  }
  const pad: PcbSmtPad = {
    type: "pcb_smtpad",
    pcb_smtpad_id: "padA",
    pcb_port_id: "port-start",
    shape: "circle",
    x: 0,
    y: 0,
    radius: 0.2,
    layer: "top",
  }
  const traces: PcbTrace[] = [
    { id: "signal", y: 0.32 },
    { id: "signal_tail", y: -0.32 },
    { id: "other", y: 0.35 },
  ].map(
    ({ id, y }): PcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: id,
      route: [-1, 1].map(
        (x): PcbTrace["route"][number] => ({
          route_type: "wire",
          x,
          y,
          width: 0.1,
          layer: "top",
        }),
      ),
    }),
  )
  const firstPoint = traces[0]!.route[0]!
  const lastPoint = traces[0]!.route[1]!
  if (firstPoint.route_type !== "wire" || lastPoint.route_type !== "wire") {
    throw new Error("The naming fixture requires planar wire endpoints")
  }
  firstPoint.start_pcb_port_id = "port-start"
  lastPoint.end_pcb_port_id = "port-end"
  const metadata: AnyCircuitElement[] = [
    boardElement,
    sourceComponent,
    component,
    ...sourcePorts,
    ...ports,
    pad,
  ]
  let board: AnyCircuitElement[] = [...metadata, ...traces]
  const connMap = new ConnectivityMap({})
  const options: { connMap: ConnectivityMap; minClearance?: number } = {
    connMap,
    minClearance: 0.2,
  }
  const prepared = createPreparedPadTraceClearanceChecker()
  const compareWithNative = (
    expectedCheckedTraces: number,
  ): ReturnType<typeof checkPadTraceClearance> => {
    const originalElements = structuredClone([...board])
    const originalMap = structuredClone({
      netMap: options.connMap.netMap,
      idToNetMap: options.connMap.idToNetMap,
    })
    const before = prepared.getStats()
    const expected = checkPadTraceClearance([...board], options)
    const actual = prepared(board, options)
    expect(actual).toEqual(expected)
    const after = prepared.getStats()
    expect(after.nativeInvocationCount - before.nativeInvocationCount).toBe(
      expectedCheckedTraces === 0 ? 0 : 1,
    )
    expect(after.nativeCheckedTraceCount - before.nativeCheckedTraceCount).toBe(
      expectedCheckedTraces,
    )
    expect(after.cachedTraceCount - before.cachedTraceCount).toBe(
      traces.length - expectedCheckedTraces,
    )
    expect(
      after.cacheEligibleEvaluationCount - before.cacheEligibleEvaluationCount,
    ).toBe(1)
    expect([...board]).toEqual(originalElements)
    expect({
      netMap: options.connMap.netMap,
      idToNetMap: options.connMap.idToNetMap,
    }).toEqual(originalMap)
    return actual
  }
  const initial = compareWithNative(3)
  const retained = structuredClone(initial)
  expect(initial.map((error) => error.pcb_trace_id)).toEqual([
    "signal",
    "signal_tail",
    "other",
  ])
  expect(initial[0]!.message).toContain(".U1 > port.start")
  const originalError = initial[0]!
  if (!originalError.center) {
    throw new Error("The fixture requires a nested native error center")
  }
  originalError.center.x = 123
  originalError.message = "mutated returned record"
  initial.reverse()
  initial.pop()
  const reused = compareWithNative(0)
  expect(reused).toEqual(retained)
  expect(reused[0]).not.toBe(originalError)
  expect(reused[0]!.center).not.toBe(originalError.center)
  const reusedError = reused[0]!
  if (!reusedError.center) {
    throw new Error("Cached native errors must retain their center")
  }
  reusedError.center.y = 456
  expect(compareWithNative(0)).toEqual(retained)

  // A route object is changed in place, not replaced. Only its group changes;
  // old returned records must also stay detached from subsequent geometry.
  firstPoint.x = -1.2
  const moved = compareWithNative(1)
  expect(moved[0]!.center).not.toEqual(retained[0]!.center)
  expect(compareWithNative(0)).toEqual(moved)
  sourceComponent.name = "Renamed"
  expect(compareWithNative(3)[0]!.message).toContain(".Renamed > port.start")
  sourcePorts[0]!.port_hints = ["1", "renamed-start"]
  expect(compareWithNative(3)[0]!.message).toContain("port.renamed-start")
  ports[0]!.source_port_id = "source-end"
  expect(compareWithNative(3)[0]!.message).toContain("port.end")
  firstPoint.start_pcb_port_id = "port-end"
  compareWithNative(1)

  // A non-copper element can shadow a physical pad's ID in the native first
  // matching-element lookup. Its position, not just its contents, matters.
  const shadow: SourceSimpleChip = {
    type: "source_component",
    ftype: "simple_chip",
    source_component_id: "padA",
    name: "First pad name",
  }
  board = [shadow, ...metadata, ...traces]
  expect(compareWithNative(3)[0]!.message).toContain(
    "source_component[First pad name]",
  )
  shadow.name = "Changed pad name"
  expect(compareWithNative(3)[0]!.message).toContain(
    "source_component[Changed pad name]",
  )
  board = [...metadata, ...traces, shadow]
  expect(compareWithNative(3)[0]!.message).not.toContain("Changed pad name")
  board = [...metadata, traces[2]!, traces[0]!, traces[1]!, shadow]
  expect(compareWithNative(3).map((error) => error.pcb_trace_id)).toEqual([
    "other",
    "signal",
    "signal_tail",
  ])

  // The checker reads idToNetMap directly through native connectivity. Changes
  // to that authoritative partition must invalidate even with the same object.
  connMap.idToNetMap.padA = "shared-net"
  connMap.idToNetMap.signal = "shared-net"
  expect(compareWithNative(3).map((error) => error.pcb_trace_id)).toEqual([
    "other",
    "signal_tail",
  ])
  delete connMap.idToNetMap.padA
  expect(compareWithNative(3)).toHaveLength(3)
  connMap.idToNetMap.signal = "renamed-net"
  compareWithNative(3)
  options.connMap = new ConnectivityMap({ otherNet: ["padA", "other"] })
  expect(compareWithNative(3).map((error) => error.pcb_trace_id)).toEqual([
    "signal",
    "signal_tail",
  ])
  options.connMap = new ConnectivityMap({ otherNet: ["padA", "other"] })
  expect(compareWithNative(0)).toHaveLength(2)
  options.minClearance = 0.04
  expect(compareWithNative(3)).toHaveLength(0)
  expect(compareWithNative(0)).toHaveLength(0)
  delete options.minClearance
  expect(compareWithNative(3)).toHaveLength(2)
  boardElement.min_trace_to_pad_edge_clearance = 0.04
  expect(compareWithNative(3)).toHaveLength(0)
  options.minClearance = 0.2
  expect(compareWithNative(3)).toHaveLength(2)
  pad.x = 10
  expect(compareWithNative(3)).toHaveLength(0)
  expect(compareWithNative(0)).toHaveLength(0)
})

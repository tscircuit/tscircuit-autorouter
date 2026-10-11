import { expect, test } from "bun:test"
import { checkTracesAreContiguous as nativeCheck } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

type Element = Record<string, any>
function makeCircuit(): Element[] {
  const wire = (x: number, layer = "top"): Element => ({ route_type: "wire", x, y: 0, width: .1, layer })
  const ports: Element[] = []
  for (const [id, source, x] of [["p1", "s1", 0], ["p2", "s2", 2], ["q1", "t1", 1], ["q2", "t2", 2]] as const) {
    ports.push({ type: "pcb_port", pcb_port_id: id, source_port_id: source, x, y: 0, layers: ["top"] })
    ports.push({ type: "pcb_smtpad", pcb_smtpad_id: `pad_${id}`, pcb_port_id: id, shape: "rect", x, y: 0, width: .2, height: .2, layer: "top" })
  }
  return [
    { type: "source_trace", source_trace_id: "A", connected_source_port_ids: ["s1", "s2"] },
    { type: "source_trace", source_trace_id: "B", connected_source_port_ids: ["t1", "t2"] },
    ...ports,
    { type: "pcb_trace", pcb_trace_id: "TA", source_trace_id: "A", route: [wire(0), wire(1)] },
    { type: "pcb_trace", pcb_trace_id: "TB", source_trace_id: "B", route: [wire(1), wire(2)] },
  ]
}

test("memoized authoritative graph retains native full graph, ordering, live connectivity and mutation semantics", () => {
  const memo = new ReferenceDrcPrimitiveMemo()
  const compare = (elements: Element[]): void => {
    const circuit = elements as AnyCircuitElement[]
    const expected = nativeCheck(circuit)
    expect(checkTracesAreContiguous(circuit, { primitiveMemo: memo })).toEqual(expected)
    expect(checkTracesAreContiguous(circuit, { primitiveMemo: memo })).toEqual(expected)
    const logical = getFullConnectivityMapFromCircuitJson(circuit)
    expect(checkTracesAreContiguous(circuit, { connMap: logical, primitiveMemo: memo })).toEqual(nativeCheck(circuit, { connMap: logical }))
    expect(getDrcErrors(circuit, { traceContinuityChecker: (input) => checkTracesAreContiguous(input, { primitiveMemo: memo }) })).toEqual(getDrcErrors(circuit))
  }
  const base = makeCircuit()
  expect(nativeCheck(base as AnyCircuitElement[])).toEqual([])
  compare(base)
  compare(base.filter((element) => element.pcb_trace_id !== "TB"))
  const a = base.find((element) => element.pcb_trace_id === "TA")!
  const b = base.find((element) => element.pcb_trace_id === "TB")!
  const pad = base.find((element) => element.pcb_smtpad_id === "pad_q1")!
  // Separate the wires while retaining their physical shared-pad bridge.
  a.route[1].x = .8; b.route[0].x = 1.2; pad.width = .6
  expect(nativeCheck(base as AnyCircuitElement[])).toEqual([])
  compare(base)
  pad.width = .1; compare(base); pad.width = .6; compare(base)
  for (const value of [.05, .2, 0]) {
    a.route[0].width = value; compare(base)
  }
  a.route[0].width = .1
  b.route[0].layer = "bottom"; b.route[1].layer = "bottom"; compare(base)
  b.route[0].layer = "top"; b.route[1].layer = "top"; compare(base)
  // Duplicate native IDs, source IDs, and original list order remain observable.
  const disconnected: Element = { ...a, route: [{ ...a.route[0], x: 3 }, { ...a.route[1], x: 4 }] }
  compare([...base, disconnected]); compare([disconnected, ...base])
  compare([...base, { ...b, pcb_trace_id: "TA" }])
  pad.shape = "rotated_rect"; pad.ccw_rotation = 37; compare(base)
  pad.ccw_rotation = 92; compare(base)
  const multilayer = makeCircuit()
  const top = multilayer.find((element) => element.pcb_trace_id === "TA")!
  const bottom = multilayer.find((element) => element.pcb_trace_id === "TB")!
  bottom.route.forEach((point: Element) => { point.layer = "bottom" })
  top.route.push({ route_type: "via", x: 1, y: 0, from_layer: "top", to_layer: "bottom", outer_diameter: .5 })
  multilayer.push({ type: "pcb_board", pcb_board_id: "board", center: { x: 1, y: 0 }, width: 20, height: 20, num_layers: 4, thickness: 1.6 })
  compare(multilayer)
  const via: Element = { type: "pcb_via", pcb_via_id: "via", pcb_trace_id: "TA", x: 1, y: 0, outer_diameter: .5, hole_diameter: .2, layers: ["top", "inner1"] }
  multilayer.push(via); compare(multilayer)
  via.layers = ["top", "inner1", "inner2", "bottom"]; compare(multilayer)
  via.x = 1.5; compare(multilayer); via.x = 1; compare(multilayer)
  const pour: Element = { type: "pcb_copper_pour", pcb_copper_pour_id: "pour", layer: "top", shape: "polygon", points: [{x: -.5,y:-.5},{x:2.5,y:-.5},{x:2.5,y:.5},{x:-.5,y:.5}], holes: [] }
  const pours = [...makeCircuit(), pour]
  compare(pours)
  pour.points[0].x = 1; compare(pours); pour.points[0].x = -.5; compare(pours)
  pour.holes = [[{x:.5,y:-.3},{x:1.5,y:-.3},{x:1.5,y:.3},{x:.5,y:.3}]]; compare(pours)
  expect(memo.diagnostics.hits).toBeGreaterThan(0)
  expect(memo.diagnostics.misses).toBeGreaterThan(0)
})

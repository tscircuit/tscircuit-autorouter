import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { checkViaTraceClearance as reference } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { checkViaTraceClearance } from "../lib/bindings/checkViaTraceClearance"

type Element = Record<string, unknown>

function trace(id: string, y: number, width = 0.1): Element {
  return {
    type: "pcb_trace", pcb_trace_id: id,
    route: [
      { route_type: "wire", x: -1, y, width, layer: "top" },
      { route_type: "wire", x: 1, y, width, layer: "top" },
    ],
  }
}

function via(id: string, y: number): Element {
  return {
    type: "pcb_via", pcb_via_id: id,
    x: 0, y, outer_diameter: 0.3, hole_diameter: 0.1,
    layers: ["top", "bottom"],
  }
}

test("native reference via clearance preserves ordered errors, numeric bits, and inputs", () => {
  const compare = (elements: Element[], nets: string[][] = [], minClearance?: number): void => {
    const circuit = elements as AnyCircuitElement[]
    const before = structuredClone(circuit)
    const connMap = new ConnectivityMap(Object.fromEntries(nets.map((ids, index) => [`net_${index}`, ids])))
    const options = { connMap, minClearance }
    const expected = reference(circuit, options)
    const actual = checkViaTraceClearance(circuit, options)
    assert.deepEqual(actual, expected)
    expect(actual).toEqual(expected)
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
    expect(circuit).toEqual(before)
  }
  compare([])
  compare([trace("empty", 0)])
  for (const gap of [-0.01, 0, 0.001, 0.09499999999999999, 0.095, 0.1]) {
    compare([trace("pcb_trace_a", 0), via("pcb_via_a", 0.2 + gap)])
  }
  compare([trace("a", 0), trace("b", 0.01), via("v", 0.24)], [["a", "v"]])
  compare([trace("same", 0), via("same", 0.24)])
  compare([trace("a", 0), trace("a", 0.1), via("v", 0.24)])
  compare([trace("a", 0.1), trace("a", 0), via("v", 0.24)])
  compare([trace("a_b", 0), trace("b", 0.1), via("v", 0.24), via("v_a", 0.24)])
  for (const id of ["", "__proto__", "constructor", "toString", "\ud800", "\ud801", "x_\ud800", "\\ud800", "\u0000net:0"]) {
    compare([trace(id, 0), via("via", 0.24)])
    compare([trace("trace", 0), via(id, 0.24)])
    compare([trace(id, 0), via(id, 0.24)])
  }
  compare([trace("nonfinite", NaN), via("v", Infinity)])
  compare([trace("signed-zero", -0, -0), via("v", 0.2)], [], Infinity)
  compare([{ type: "pcb_board", min_trace_to_pad_edge_clearance: 0.3 }, trace("a", 0), via("v", 0.4)])
  compare([trace("a", 0), { ...via("v", 0.24), layers: undefined }])
  compare([trace("a", 0), { ...via("v", 0.24), layers: ["inner1"] }])
  for (const width of [undefined, null, 0, NaN]) {
    const element = trace("width", 0)
    for (const point of element.route as Element[]) point.width = width
    compare([element, via("v", 0.24)])
    for (const point of element.route as Element[]) delete point.width
    compare([element, via("v", 0.24)])
  }
  const degenerate = trace("zero-length", 0)
  degenerate.route = [(degenerate.route as Element[])[0], (degenerate.route as Element[])[0]]
  compare([degenerate, { ...via("v", 0.24), x: -1 }])
  for (const layer of ["\ud800", "\ud801", "\\ud800"]) {
    const element = trace("layer", 0)
    for (const point of element.route as Element[]) point.layer = layer
    compare([element, { ...via("v", 0.24), layers: ["\ud800"] }])
  }
  const asymmetric = [trace("net_1", 0), via("v", 0.24)]
  compare(asymmetric, [["net_1"], ["v"]])
  const through = trace("through", 0)
  through.route = [
    { route_type: "through_pad", start: { x: -3, y: -1 }, end: { x: -1, y: 0 }, layer: "top" },
    ...(through.route as Element[]),
    { route_type: "through_pad", start: { x: 1, y: 0 }, end: { x: 5, y: 2 }, layer: "top" },
  ]
  compare([through, via("v", 0.24)])
  let seed = 34532
  const random = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  for (let iteration = 0; iteration < 100; iteration++) {
    const elements: Element[] = []
    for (let index = 0; index < 5; index++) {
      const route = trace(`pcb_trace_${index}`, random(), random() / 2)
      for (const point of route.route as Element[]) {
        point.x = random() * 2
        point.y = random() * 2
      }
      elements.push(route, { ...via(`pcb_via_${index}`, random() * 2), x: random() * 2 })
    }
    compare(elements, [], random() / 2)
  }
})

import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson, type PhysicalPadElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { evaluateConnectionCoverage } from "../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import { loadSrj18PhysicalPadElements } from "../scripts/parallel-benchmark/loadSrj18PhysicalPadElements"

test("original CAD square pads retain real corners while circular pads and missing spans cannot prove them", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [{ name: "net", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
      { x: 2, y: 0.9, layer: "bottom", pcb_port_id: "end" },
    ] }],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 2, height: 2,
      layers: ["top", "bottom"], connectedTo: ["start", "net"],
      circuitJsonMetadata: { pcb_plated_hole_id: "hole", pcb_port_id: "start" },
    }],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "trace", connection_name: "net",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top", start_pcb_port_id: "start" },
      { route_type: "wire", x: 0.9, y: 0.9, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.9, y: 0.9, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0.9, width: 0.1, layer: "bottom", end_pcb_port_id: "end" },
    ],
  }
  const rect: PhysicalPadElement = {
    type: "pcb_plated_hole", pcb_plated_hole_id: "hole", pcb_port_id: "start",
    shape: "circular_hole_with_rect_pad", hole_shape: "circle", pad_shape: "rect",
    x: 0, y: 0, hole_diameter: 1.1, rect_pad_width: 2, rect_pad_height: 2,
    rect_ccw_rotation: 180, hole_offset_x: 0, hole_offset_y: 0, layers: ["top", "bottom"],
  }
  const originalState = JSON.stringify({ input, trace, rect })
  const legacy = convertToCircuitJson(input, [trace])
  expect(legacy.find((element) => element.type === "pcb_plated_hole")).toMatchObject({ shape: "circle", outer_diameter: 2 })
  expect(convertToCircuitJson(input, [trace], { physicalPadElements: undefined })).toEqual(legacy)
  expect(evaluateConnectionCoverage(input, legacy).summary.errorCount).toBe(1)
  const physical = convertToCircuitJson(input, [trace], { physicalPadElements: [rect] })
  expect(physical.find((element) => element.type === "pcb_plated_hole")).toEqual(rect)
  expect(physical.filter((element) => element.type === "pcb_plated_hole")).toHaveLength(1)
  expect(physical.filter((element) => element.type === "pcb_via")).toHaveLength(0)
  expect(evaluateConnectionCoverage(input, physical).summary).toMatchObject({ requiredNetCount: 1, coveredNetCount: 1, errorCount: 0 })
  const evaluated = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: input, routedTraces: [trace], physicalPadElements: [rect] })
  expect(evaluated.circuitJson.find((element) => element.type === "pcb_plated_hole")).toEqual(rect)
  const onlyTop = convertToCircuitJson(input, [trace], { physicalPadElements: [{ ...rect, layers: ["top"] }] })
  expect(evaluateConnectionCoverage(input, onlyTop).summary.errorCount).toBe(1)
  const circle: PhysicalPadElement = { type: "pcb_plated_hole", pcb_plated_hole_id: "hole", pcb_port_id: "start", shape: "circle", x: 0, y: 0, outer_diameter: 2, hole_diameter: 1.1, layers: ["top", "bottom"] }
  expect(evaluateConnectionCoverage(input, convertToCircuitJson(input, [trace], { physicalPadElements: [circle] })).summary.errorCount).toBe(1)
  expect(JSON.stringify({ input, trace, rect })).toBe(originalState)
  const outputPad = physical.find((element) => element.type === "pcb_plated_hole")!
  outputPad.x = 100
  expect(rect.x).toBe(0)
  expect(() => convertToCircuitJson(input, [trace], { physicalPadElements: [{ type: "pcb_trace" } as unknown as PhysicalPadElement] })).toThrow("Physical pad conversion accepts only original pads and holes")
  const pads = loadSrj18PhysicalPadElements({ ...input, sourceCircuitJson: "circuit-json/sample015-sdi-fiber-adapter.json" } as SimpleRouteJson)!
  expect(pads.length).toBeGreaterThan(0)
  expect(pads.every((element: AnyCircuitElement) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole" || element.type === "pcb_hole")).toBe(true)
  expect(pads.find((element) => element.type === "pcb_plated_hole" && element.pcb_plated_hole_id === "pcb_plated_hole_23")).toMatchObject({ shape: "circular_hole_with_rect_pad", rect_pad_width: 2, rect_pad_height: 2, rect_ccw_rotation: 180, hole_diameter: 1.1, layers: ["top", "inner1", "inner2", "bottom"] })
  expect(loadSrj18PhysicalPadElements(input)).toBeUndefined()
  expect(() => loadSrj18PhysicalPadElements({ ...input, sourceCircuitJson: "../circuit-json/sample015.json" } as SimpleRouteJson)).toThrow("Invalid original SRJ18 Circuit JSON path")
})

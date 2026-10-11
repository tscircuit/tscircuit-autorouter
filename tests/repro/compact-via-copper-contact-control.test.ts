import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import type { SimplifiedPcbTrace } from "lib/types"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { getCompactViaCopperCircuit } from "tests/fixtures/compactViaCopperCircuit"

/** Physical segments in board-world mm (+X right, +Y up); zero-length contacts add no copper. */
function getPhysicalSegments(trace: SimplifiedPcbTrace): Array<{ start: { x: number; y: number }; end: { x: number; y: number }; width: number; layer: string }> {
  const segments: ReturnType<typeof getPhysicalSegments> = []
  for (let index = 0; index < trace.route.length - 1; index++) {
    const start = trace.route[index]!
    const end = trace.route[index + 1]!
    if ((start.route_type !== "wire" && start.route_type !== "via") || (end.route_type !== "wire" && end.route_type !== "via")) throw new Error("Unexpected fixture route point")
    if (start.x === end.x && start.y === end.y) continue
    const wire = start.route_type === "wire" ? start : end
    if (wire.route_type !== "wire") throw new Error("A physical segment requires a wire width")
    segments.push({ start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, layer: wire.layer, width: wire.width })
  }
  return segments
}

test("authored via contact wires preserve copper and avoid the inherited compact-route continuity warning", async (): Promise<void> => {
  const compact = await getCompactViaCopperCircuit()
  const control = await getCompactViaCopperCircuit(true)
  expect(compact.srj.layerCount).toBe(4)
  expect(control.srj.layerCount).toBe(4)
  expect(compact.circuitJson.find((element) => element.type === "pcb_board")!.num_layers).toBe(4)
  expect(control.srj.traces![0]!.route.map((point) => point.route_type)).toEqual(["wire", "wire", "via", "wire", "wire"])
  expect(getPhysicalSegments(compact.srj.traces![0]!)).toEqual(getPhysicalSegments(control.srj.traces![0]!))
  expect(getPhysicalSegments(compact.srj.traces![0]!)).toEqual([
    { start: { x: 0, y: -2 }, end: { x: 0, y: 1 }, layer: "top", width: 0.2 },
    { start: { x: 0, y: 1 }, end: { x: 2, y: 1 }, layer: "bottom", width: 0.2 },
  ])
  const inheritedErrors = getDrcErrors(compact.circuitJson, { includeTraceContinuity: true }).errors
  expect(inheritedErrors).toHaveLength(1)
  expect(inheritedErrors[0]).toMatchObject({ pcb_trace_error_id: "misaligned_via_pcb_trace_0_1", pcb_trace_id: "pcb_trace_0" })
  expect(getDrcErrors(control.circuitJson).errors).toEqual([])
  const solver = new AutoroutingPipelineSolver4(control.srj)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  const layers = ["top", "inner1", "inner2", "bottom"]
  for (const trace of traces) for (const point of trace.route) {
    if (point.route_type === "wire") expect(layers).toContain(point.layer)
    else if (point.route_type === "via") {
      expect(layers).toContain(point.from_layer)
      expect(layers).toContain(point.to_layer)
    } else throw new Error("Unexpected native route point")
  }
  const routedCircuitJson = [...control.circuitJson, ...traces.map((trace) => ({ type: "pcb_trace" as const, pcb_trace_id: trace.pcb_trace_id, source_trace_id: trace.connection_name, route: trace.route }))] as CircuitJson
  expect(getDrcErrors(routedCircuitJson).errors).toEqual([])
})

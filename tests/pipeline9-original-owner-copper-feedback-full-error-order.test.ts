import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { checkPipeline9OriginalIntentCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9OriginalIntentCopper"

test("legacy inherited checker entries retain the original failure before late raw geometry reads", (): void => {
  let reads = 0
  const route = [{ route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
    { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.2 }]
  const via = { type: "pcb_via", pcb_via_id: "via", pcb_trace_id: "trace", y: 0,
    layers: ["top", "bottom"], outer_diameter: 0.3, hole_diameter: 0.15 }
  Object.defineProperty(via, "x", { enumerable: true, get(): number {
    reads++
    if (reads === 2) throw new Error("late raw geometry read")
    return 0
  } })
  const original = { layerCount: 2, connections: [{ name: "A", pointsToConnect: [] }], obstacles: [] }
  expect(() => checkPipeline9OriginalIntentCopper({ original, pointPairs: original,
    traces: [{ pcb_trace_id: "trace", connection_name: "A", route }],
    circuitJson: [{ type: "pcb_trace", pcb_trace_id: "trace", route }, via] },
  Object.create({ viaPad: checkViaPadClearance }))).toThrow(TypeError)
  expect(reads).toBe(1)
})

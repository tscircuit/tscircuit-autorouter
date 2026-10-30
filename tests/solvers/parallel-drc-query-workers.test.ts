import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import { ParallelAutoroutingDrcEngine } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/ParallelAutoroutingDrcEngine"

test("persistent parallel DRC preserves ordered errors and logical checks across changing candidates", async (): Promise<void> => {
  const srj = {
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [{
      type: "rect" as const,
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["pcb_smtpad_1", "pad-net"],
    }],
    connections: [],
  }
  const serial = new AutoroutingDrcEngine(srj, {})
  const parallel = new ParallelAutoroutingDrcEngine(srj, {})
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    await parallel.enable(runtime)
    for (const offset of [0, 0.01, 0, -0, 0.2]) {
      const traces = Array.from({ length: 24 }, (_, index) => ({
        pcb_trace_id: "trace-" + index,
        connection_name: "net-" + index,
        route: [
          { route_type: "wire" as const, x: -5, y: index / 10 + offset, layer: "top", width: 0.1 },
          { route_type: "wire" as const, x: 5, y: -index / 10, layer: "top", width: 0.1 },
        ],
      }))
      const expected = serial.evaluate(traces)
      expect(expected.errors.length).toBeGreaterThan(0)
      expect(parallel.evaluate(traces)).toEqual(expected)
      expect(parallel.lastRunStats).toEqual(serial.lastRunStats)
      expect(parallel.evaluateLegacy(traces)).toEqual(serial.evaluateLegacy(traces))
    }
  } finally {
    await parallel.close()
    await runtime.dispose()
  }
})

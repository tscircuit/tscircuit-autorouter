import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { getDrcErrors, withDrcCheckExecutor } from "../../lib/testing/getDrcErrors"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { ParallelDrcChecksSession } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/ParallelDrcChecksSession"

test("parallel reference checks preserve errors and centers across changing candidates", async (): Promise<void> => {
  const srj = {
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
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
  const session = new ParallelDrcChecksSession()
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    await session.enable(runtime)
    const circuit: Parameters<typeof getDrcErrors>[0] = [
      { type: "pcb_port" as const, pcb_port_id: "port-a", pcb_component_id: "component-a", source_port_id: "source-a", x: -1, y: 0, layers: ["top"] },
      { type: "pcb_port" as const, pcb_port_id: "port-b", pcb_component_id: "component-b", source_port_id: "source-b", x: 1, y: 0, layers: ["top"] },
      { type: "pcb_trace" as const, pcb_trace_id: "annotation-trace", route: [
        { route_type: "wire" as const, x: -1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire" as const, x: 1, y: 0, layer: "top", width: 0.1 },
      ] },
    ]
    const serialCircuit = structuredClone(circuit)
    const parallelCircuit = structuredClone(circuit)
    const serialErrors = getDrcErrors(serialCircuit)
    expect(withDrcCheckExecutor(session.evaluate, () => getDrcErrors(parallelCircuit))).toEqual(serialErrors)
    expect(parallelCircuit).toEqual(serialCircuit)
    expect((parallelCircuit[2] as any).route[0].start_pcb_port_id).toBe("port-a")
    expect((parallelCircuit[2] as any).route[1].end_pcb_port_id).toBe("port-b")
    for (const offset of [0, 0.01, 0, -0, 0.2]) {
      const traces = Array.from({ length: 12 }, (_, index) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: "trace-" + index,
        connection_name: "net-" + index,
        route: [
          { route_type: "wire" as const, x: -5, y: index / 10 + offset, layer: "top", width: 0.1 },
          { route_type: "wire" as const, x: 5, y: -index / 10, layer: "top", width: 0.1 },
        ],
      }))
      const input = { inputSrj: srj, srjWithPointPairs: srj, routedTraces: traces }
      const expected = evaluateRelaxedDrc(input)
      expect(expected.errors.length).toBeGreaterThan(0)
      expect(withDrcCheckExecutor(session.evaluate, () => evaluateRelaxedDrc(input))).toEqual(expected)
    }
  } finally {
    await session.close()
    await runtime.dispose()
  }
})

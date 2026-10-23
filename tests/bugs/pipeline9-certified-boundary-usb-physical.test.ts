import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../../lib/types"
import phase1Input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"
import phase0Input from "../fixtures/bug-reports/usb-dp-phase-detour/phase-0.input.json"

test("certified boundaries preserve full USB phase connectivity, physical clearance and exact preload endpoints", (): void => {
  const route = (input: SimpleRouteJson): SimpleRouteJson => {
    const solver = new Pipeline(structuredClone(input), { effort: 1, cacheProvider: null })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.boundaryContractSolver!.solved).toBe(true)
    const output = solver.getOutputSimpleRouteJson()
    expect(evaluateRelaxedDrc({ inputSrj: output, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: [], includeBoardClearance: true }).errors).toEqual([])
    expect(new Set(output.traces!.map((trace) => trace.pcb_trace_id)).size).toBe(output.traces!.length)
    const movable = new Set(solver.getMutatedPreloadedTraces().map((trace) => trace.pcb_trace_id))
    for (const original of input.traces ?? []) {
      const updated = output.traces!.find((trace) => trace.pcb_trace_id === original.pcb_trace_id)!
      expect(updated).toBeDefined()
      expect(updated.connection_name).toBe(original.connection_name)
      expect(updated.connectsTo).toEqual(original.connectsTo)
      expect(updated.route[0]).toEqual(original.route[0])
      expect(updated.route.at(-1)).toEqual(original.route.at(-1))
      if (JSON.stringify(updated.route) !== JSON.stringify(original.route)) {
        expect(movable.has(original.pcb_trace_id)).toBe(true)
        expect(updated.__replaces_pcb_trace_id).toBe(original.pcb_trace_id)
      }
    }
    return output
  }
  route(phase1Input)
  const phase0 = route(phase0Input)
  route({ ...structuredClone(phase1Input), traces: phase0.traces })
})

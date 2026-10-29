import { expect, test } from "bun:test"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { evaluatePreparedRepairDrc } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/evaluatePreparedRepairDrc"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared repair wrapper preserves complete native reference results, preloaded replacement and declared-rule options", (): void => {
  for (let seed = 0; seed < 6; seed++) {
    const { srj, originalSrj, traces } = createPreparedRepairCircuitInput(seed)
    originalSrj.traces = [structuredClone(traces[0]!)]
    traces[0]!.__replaces_pcb_trace_id = originalSrj.traces[0]!.pcb_trace_id
    for (const includeBoardClearance of [false, true]) {
      for (const includeTraceContinuity of [false, true]) {
        const input = {
          inputSrj: originalSrj,
          srjWithPointPairs: srj,
          routedTraces: traces,
          includeBoardClearance,
          drcOptions: {
            includeTraceContinuity,
            traceClearance: 0.1 + seed / 100,
            viaClearance: 0.15,
          },
        }
        const circuitJsonConverter = createPreparedRepairCircuitJsonConverter(srj, {
          originalSrj,
          includeOriginalConnections: true,
          minTraceWidth: originalSrj.minTraceWidth,
          minViaDiameter: originalSrj.minViaDiameter,
        }, createPreparedRepairCircuitStats())
        const snapshot = structuredClone(input)
        expect(evaluatePreparedRepairDrc({ ...input, circuitJsonConverter })).toEqual(evaluateRelaxedDrc(input))
        expect(input).toEqual(snapshot)
      }
    }
  }
})

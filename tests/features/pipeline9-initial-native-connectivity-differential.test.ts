import { expect, test } from "bun:test"
import { createInitialRepairConnectivityMaps, type InitialRepairConnectivityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createInitialRepairConnectivityMaps"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { createPreparedRepairCircuitInput } from "../fixtures/initial-repair-connectivity-input"

test("initial connectivity reuse preserves full native findings and geometry across normalized JSON contexts", (): void => {
  for (let seed = 0; seed < 24; seed++) {
    for (const identity of ["same", "distinct", "original-only"] as const) {
      for (const preload of [false, true]) {
        const input = createPreparedRepairCircuitInput(seed)
        const originalSrj = identity === "same" ? input.srj
          : identity === "distinct" ? structuredClone(input.srj) : input.originalSrj
        if (preload) originalSrj.traces = [structuredClone(input.traces[0]!)]
        const stats: InitialRepairConnectivityStats = {
          extraNormalizationCalls: 0, sourceMapBuilds: 0, routeMapBuilds: 0,
          sourceMapReuses: 0, routeMapReuses: 0,
        }
        const maps = createInitialRepairConnectivityMaps(input.srj, originalSrj, stats)
        expect(stats.extraNormalizationCalls).toBe(0)
        const freeze = (value: unknown): void => {
          if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
          Object.freeze(value)
          for (const child of Object.values(value)) freeze(child)
        }
        freeze(input.srj)
        freeze(originalSrj)
        let retained: ReturnType<typeof evaluateRelaxedDrc> | undefined
        for (const routes of [[], input.traces]) {
          const params = {
            inputSrj: originalSrj as SimpleRouteJson,
            srjWithPointPairs: input.srj,
            routedTraces: routes,
            includeBoardClearance: true,
            drcOptions: { traceClearance: 0.1, viaClearance: 0.1 },
          }
          const native = evaluateRelaxedDrc(params)
          const reused = evaluateRelaxedDrc({ ...params, connectivityMaps: maps })
          expect(reused).toEqual(native)
          if (retained) expect(retained).toEqual(evaluateRelaxedDrc({ ...params, routedTraces: [] }))
          else retained = reused
        }
        expect(stats).toEqual({ extraNormalizationCalls: 2, sourceMapBuilds: 1,
          routeMapBuilds: 1, sourceMapReuses: 1, routeMapReuses: 1 })
      }
    }
  }
})

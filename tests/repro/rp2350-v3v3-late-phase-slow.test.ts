import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/repro/rp2350-v3v3-late-phase-slow/rp2350-v3v3-late-phase-slow.srj.json" with {
  type: "json",
}

test.skip("Pipeline9 routes the RP2350 V3V3 net around 61 preloaded fanout traces", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj) as SimpleRouteJson,
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
})

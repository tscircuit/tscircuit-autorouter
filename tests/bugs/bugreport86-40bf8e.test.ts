import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test.skip("Pipeline9 routes LCD traces around the 76 preloaded traces in bugreport86-40bf8e", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  // Pipeline9 currently injects boundary-crossing preloads into the
  // hypergraph, but rebuilds the later high-density geometry from the
  // original SRJ. Local fanout stubs that never cross a graph boundary are
  // therefore only movable through the broad regional fallback. That fallback
  // currently promotes every XY-overlapping section without layer filtering;
  // cmn_4 consequently considers 139 fragments for rerouting, including 127
  // top-layer-only fragments despite its target pairs using inner layers.
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
})

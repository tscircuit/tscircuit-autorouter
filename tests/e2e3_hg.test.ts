import { expect, test } from "bun:test"
import { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"
import { getFreshE2e3 } from "./fixtures/getFreshE2e3"

test("should produce last-step svg for e2e3 hg pipeline", () => {
  /**
   * Load a fresh `e2e3` fixture instance for each test.
   *
   * Why: Bun caches JSON module imports by path. We previously imported
   * `fixtures/legacy/assets/e2e3.json` directly in multiple tests, and one test
   * mutated the SRJ object (connection point ordering + obstacle fields). That
   * leaked into later tests and caused order-dependent snapshot failures
   * (single-file pass vs full-suite fail).
   */
  const simpleSrj: SimpleRouteJson = getFreshE2e3()

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(simpleSrj)
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 20_000)

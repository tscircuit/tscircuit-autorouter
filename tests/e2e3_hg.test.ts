import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

test("should produce last-step svg for e2e3 hg pipeline", () => {
  const simpleSrj = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(simpleSrj)
  while (!solver.solved && !solver.failed) {
    solver.step()
    solver.visualize()
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 20_000)

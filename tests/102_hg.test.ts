import { expect, test } from "bun:test"
import { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import e2e3 from "fixtures/legacy/assets/e2e3.json" with { type: "json" }
import { circuit102 } from "@tscircuit/autorouting-dataset-01"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

test("should produce last-step svg for circuit002 hg pipeline", () => {
  const simpleSrj: SimpleRouteJson = circuit102 as any

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(simpleSrj)
  solver.solve()

  expect(solver.solved).toBeTrue()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 20_000)

import { expect, test } from "bun:test"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import e2e3 from "fixtures/legacy/assets/e2e3.json" with { type: "json" }

test("should solve e2e3 board with hg pipeline and produce valid output", () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(simpleSrj)
  solver.solve()

  expect(solver.solved).toBe(true)

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 20_000)

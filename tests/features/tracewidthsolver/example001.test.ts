import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import input from "./assets/example001.json"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { annotateNominalTraceWidth } from "lib/utils/annotateNominalTraceWidth"

test("example001", async () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(input) as SimpleRouteJson,
  )
  solver.solve()
  const srj = solver.getOutputSimpleRouteJson()
  expect(
    annotateNominalTraceWidth(convertSrjToGraphicsObject(srj), srj),
  ).toMatchGraphicsSvg(import.meta.path)
})

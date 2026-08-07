import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport85-pico-usb-differential-pair/bugreport85-pico-usb-differential-pair.srj.json" with {
  type: "json",
}

test("bugreport85 Pico USB best-effort route visualization", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
    { cacheProvider: null },
  )

  solver.solve()

  expect(
    getSvgFromGraphicsObject(
      solver.lengthMatchingPostProcessingSolver!.visualize(),
      {
        backgroundColor: "white",
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import srjJson from "../../fixtures/bug-reports/bugreport106-allwinner-t113-routing-timeout/bugreport106-allwinner-t113-routing-timeout.srj.json" with {
  type: "json",
}

test.skip("bugreport106 reaches Pipeline9 global pathing on the Allwinner T113 board", async () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srjJson) as SimpleRouteJson,
    { cacheProvider: null, effort: 1 },
  )

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver).toBeDefined()
  await expect(
    getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(solver.srjWithPointPairs!),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

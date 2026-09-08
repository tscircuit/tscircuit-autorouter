import { expect, test } from "bun:test"
import { getNewViaPadViolations, getRepairViaGeometry } from "@tscircuit/repair04"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import bugReport from "../../fixtures/bug-reports/bugreport68-41562e/bugreport68-41562e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport68-41562e.json", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toHaveLength(0)
  const routes = solver._getOutputHdRoutes()
  const physicalSrj = createSrjWithBoardValidObstacleLayers({
    ...srj,
    connections: [...srj.connections, ...solver.srjWithPointPairs!.connections],
  })
  const includeExistingVias = routes.flatMap((route, routeIndex) =>
    getRepairViaGeometry(route, srj.layerCount).map((_, viaIndex) => ({
      routeIndex,
      viaIndex,
    })),
  )
  expect(
    getNewViaPadViolations({
      srj: { ...physicalSrj, traces: undefined },
      routes,
      previousRoutes: routes,
      includeExistingVias,
    }),
  ).toHaveLength(0)
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 300_000)

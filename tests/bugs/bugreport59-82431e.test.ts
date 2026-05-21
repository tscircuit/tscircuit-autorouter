import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getAssignableViaPointKeys } from "lib/utils/assignableViaUtils"
import { getXyPointKey } from "lib/utils/getXyPointKey"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport59-82431e.json", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()

  const preplacedViaPointKeys = getAssignableViaPointKeys(srj.obstacles)
  const routedViaPointKeys =
    solver
      .getOutputSimpleRouteJson()
      .traces?.flatMap((trace) =>
        trace.route
          .filter((segment) => segment.route_type === "via")
          .map(getXyPointKey),
      ) ?? []

  expect(solver.portPointPathingSolver?.getSolverName()).toBe(
    "TinyHypergraphPortPointPathingSolver",
  )
  const stageNames = solver.pipelineDef.map((stage) => stage.solverName)
  expect(stageNames).not.toContain("preplacedViaSnapSolver")
  expect(stageNames.indexOf("singleLayerNodePortPointSolver")).toBeLessThan(
    stageNames.indexOf("portPointPathingSolver"),
  )
  expect(
    solver.singleLayerNodePortPointSolver
      ?.getOutput()
      .capacityMeshNodes.every((node) => node.availableZ.length === 1),
  ).toBe(true)
  expect(routedViaPointKeys.length).toBeGreaterThan(0)
  expect(
    routedViaPointKeys.every((viaPointKey) =>
      preplacedViaPointKeys.has(viaPointKey),
    ),
  ).toBe(true)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 10_000)

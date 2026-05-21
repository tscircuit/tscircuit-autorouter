import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4, AutoroutingPipelineSolver8 } from "lib"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson
const getPreplacedViaPointKeys = (obstacles: Obstacle[]) =>
  new Set(
    obstacles
      .filter(
        (obstacle) =>
          obstacle.netIsAssignable === true &&
          obstacle.layers.includes("top") &&
          obstacle.layers.includes("bottom") &&
          obstacle.connectedTo.some((connectedId) =>
            connectedId.startsWith("pcb_via"),
          ),
      )
      .map(
        (obstacle) =>
          `${obstacle.center.x.toFixed(4)},${obstacle.center.y.toFixed(4)}`,
      ),
  )

const getDrcErrorIds = (solver: {
  solve: () => void
  getOutputSimpleRouteJson: () => SimpleRouteJson
}) => {
  solver.solve()
  const outputSrj = solver.getOutputSimpleRouteJson()
  const circuitJson = convertToCircuitJson(outputSrj, outputSrj.traces ?? [], {
    minTraceWidth: srj.minTraceWidth,
    originalSrj: srj,
  })

  return getDrcErrors(circuitJson).errors.map((error) =>
    "pcb_trace_error_id" in error
      ? error.pcb_trace_error_id
      : "pcb_error_id" in error
        ? error.pcb_error_id
        : JSON.stringify(error),
  )
}

test("bugreport59-82431e.json", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()

  const preplacedViaPointKeys = getPreplacedViaPointKeys(srj.obstacles)
  const routedViaPointKeys =
    solver
      .getOutputSimpleRouteJson()
      .traces?.flatMap((trace) =>
        trace.route
          .filter((segment) => segment.route_type === "via")
          .map((segment) => `${segment.x.toFixed(4)},${segment.y.toFixed(4)}`),
      ) ?? []

  expect(solver.portPointPathingSolver?.getSolverName()).toBe(
    "TinyHypergraphPortPointPathingSolver",
  )
  expect(routedViaPointKeys.length).toBeGreaterThan(0)
  expect(
    routedViaPointKeys.every((viaPointKey) =>
      preplacedViaPointKeys.has(viaPointKey),
    ),
  ).toBe(true)

  const pipeline4DrcErrorIds = new Set(
    getDrcErrorIds(new AutoroutingPipelineSolver4(srj)),
  )
  const pipeline8DrcErrorIds = getDrcErrorIds(
    new AutoroutingPipelineSolver8(srj),
  )
  expect(
    pipeline8DrcErrorIds.every((errorId) => pipeline4DrcErrorIds.has(errorId)),
  ).toBe(true)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 10_000)

import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport02-bc4361/bugreport02-bc4361.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport2", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj)

  // // solve until the high density route solver, take a snapshot of the
  // // visualization from the port point pathing solver
  // solver.solveUntilPhase("simpleHighDensityRouteSolver")

  // expect(
  //   getLastStepSvg(solver.portPointPathingSolver!.visualize()),
  // ).toMatchSvgSnapshot(import.meta.path, {
  //   svgName: "bugreport27-portPointPathingSolver",
  // })

  solver.solve()
  const outputSrj = solver.getOutputSimpleRouteJson()
  const traceCountByConnectionName = new Map<string, number>()

  for (const trace of outputSrj.traces ?? []) {
    const connectionName = trace.connection_name
    traceCountByConnectionName.set(
      connectionName,
      (traceCountByConnectionName.get(connectionName) ?? 0) + 1,
    )
  }

  expect(outputSrj.traces?.length).toBe(19)
  expect(traceCountByConnectionName.get("source_trace_4__source_net_2")).toBe(4)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

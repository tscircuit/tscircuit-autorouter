import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport19/bugreport19.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport as SimpleRouteJson

test("bugreport19.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
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

  expect(outputSrj.traces?.length).toBe(11)
  expect(traceCountByConnectionName.get("source_trace_7__source_trace_8")).toBe(
    2,
  )
  expect(
    traceCountByConnectionName.get(
      "source_trace_5__source_trace_9__source_trace_10",
    ),
  ).toBe(3)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

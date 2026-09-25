import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { AutoroutingPipelineSolver11_Simplification } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/AutoroutingPipelineSolver11_Simplification"
import bugReport from "../../fixtures/bug-reports/bugreport64-be7d8f/bugreport64-be7d8f.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("simplify phase on bugreport64-be7d8f.json", (): void => {
  const routingSolver = new AutoroutingPipelineSolver(structuredClone(srj))
  routingSolver.solve()
  expect(routingSolver.solved).toBe(true)
  const input = routingSolver.getOutputSimpleRouteJson()
  const inputSnapshot = structuredClone(input)
  const solver = new AutoroutingPipelineSolver11_Simplification(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.traceSimplificationStageSolver?.traceSimplificationSolver
      .simplificationPipelineLoops,
  ).toBe(2)
  expect(input).toEqual(inputSnapshot)
  const sourceTrace6 = solver
    .getOutputSimplifiedPcbTraces()
    .find((trace) => trace.pcb_trace_id === "source_trace_6_0")
  expect(sourceTrace6).toBeDefined()
  const sourceTrace6Wires =
    sourceTrace6?.route.filter((segment) => segment.route_type === "wire") ?? []
  const narrowPad = srj.obstacles.find(
    (obstacle) =>
      obstacle.connectedTo.includes("source_trace_6") &&
      obstacle.height < srj.minTraceWidth,
  )!
  expect(narrowPad).toBeDefined()
  const narrowPadRightEdge = narrowPad.center.x + narrowPad.width / 2

  for (const wire of sourceTrace6Wires) {
    if (wire.x >= narrowPadRightEdge - 1e-6) continue
    expect(wire.width).toBeLessThanOrEqual(narrowPad.height + 1e-6)
  }
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

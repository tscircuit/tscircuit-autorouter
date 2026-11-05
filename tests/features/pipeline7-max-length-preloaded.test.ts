import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  createPipeline7LengthInput,
  getPipeline7LengthSnapshot,
} from "tests/fixtures/pipeline7-max-length"

test("Pipeline7 includes preserved copper when enforcing maxLength", async (): Promise<void> => {
  const input = createPipeline7LengthInput(3)
  input.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "preloaded_signal",
      connection_name: "SIGNAL",
      route: [
        { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.15 },
        { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.15 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.15 },
      ],
    },
  ]
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
    effort: 0.1,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(input).toEqual(original)
  const feasible = createPipeline7LengthInput(5)
  feasible.traces = structuredClone(input.traces)
  const feasibleSolver = new AutoroutingPipelineSolver7_MultiGraph(feasible, {
    cacheProvider: null,
    effort: 0.1,
  })
  feasibleSolver.solve()
  expect(feasibleSolver.solved).toBe(true)
  expect(feasibleSolver.failed).toBe(false)
  await expect(
    getPipeline7LengthSnapshot(
      input,
      solver.srjWithPointPairs!,
      solver.powerTraceExpansionSolver!.getOutput(),
      `Preloaded signal: 4.47 mm / 3 mm limit; ${solver.solved ? "ACCEPTED" : "REJECTED"}`,
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

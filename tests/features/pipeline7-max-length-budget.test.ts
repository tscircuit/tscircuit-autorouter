import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  createPipeline7LengthInput,
  getPipeline7LengthSnapshot,
} from "tests/fixtures/pipeline7-max-length"

test("Pipeline7 rejects an over-budget route and accepts a feasible budget", async (): Promise<void> => {
  const input = createPipeline7LengthInput(3)
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
    effort: 0.1,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("signal connection")
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow()
  const traces = solver.powerTraceExpansionSolver!.getOutput()
  expect(traces).toHaveLength(1)
  const route = traces[0]!.route
  const wirePoints = route.filter((point) => point.route_type === "wire")
  expect(wirePoints).toHaveLength(route.length)
  const length = wirePoints.slice(1).reduce((total, point, index) => {
    const previous = wirePoints[index]!
    return total + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
  expect(length).toBe(4)
  expect(input).toEqual(original)

  const feasible = new AutoroutingPipelineSolver7_MultiGraph(
    createPipeline7LengthInput(5),
    { cacheProvider: null, effort: 0.1 },
  )
  feasible.solve()
  expect(feasible.solved).toBe(true)
  expect(feasible.failed).toBe(false)
  await expect(
    getPipeline7LengthSnapshot(
      input,
      solver.srjWithPointPairs!,
      traces,
      `Signal: ${length} mm / 3 mm limit; ${solver.solved ? "ACCEPTED" : "REJECTED"}`,
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

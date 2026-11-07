import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("minimum-width planning indexes the complete rotated obstacle envelope", (): void => {
  const input = getConnectionMinimumTraceWidthInput()
  for (const obstacle of input.obstacles) {
    if (obstacle.connectedTo.length > 0) continue
    // Preserve physical geometry while making its stored dimensions different
    // from its world-space bounds. A centre-only/unrotated index misses it.
    const width = obstacle.width
    obstacle.width = obstacle.height
    obstacle.height = width
    obstacle.ccwRotationDegrees = 90
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const wires = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "wire"),
  )
  expect(wires.length).toBeGreaterThan(0)
  expect(wires.every((point) => point.width >= 0.4 - 1e-6)).toBe(true)
  expect(wires.some((point) => Math.abs(point.y) > 2.9)).toBe(true)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
      drcOptions: { includeTraceContinuity: false, traceClearance: 0.13 },
    }).errors,
  ).toEqual([])
})

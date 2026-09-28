import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 hands early length-matched routes to native trace routing", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: 0, y: -3, layer: "top", pcb_port_id: "ordinary_start" },
      { x: 10, y: -3, layer: "top", pcb_port_id: "ordinary_end" },
    ],
  })
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  expect(solver.pipelineDef.slice(0, 2).map((step) => step.solverName)).toEqual(
    ["preprocessSimpleRouteJsonSolver", "lengthMatchingPostProcessingSolver"],
  )
  solver.solveUntilPhase("componentDetectionSolver")
  expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
  expect(solver.srj.traces).toHaveLength(3)
  expect(solver.srj.obstacles).toHaveLength(input.obstacles.length)
  expect(solver.srj.connections.map((connection) => connection.name)).toEqual([
    "ordinary",
  ])
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(input).toEqual(original)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(new Set(routedTraces.map((trace) => trace.connection_name))).toEqual(
    new Set(["a", "b", "ordinary"]),
  )
  expect(new Set(routedTraces.map((trace) => trace.pcb_trace_id)).size).toBe(
    routedTraces.length,
  )
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toHaveLength(0)
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 routes constrained connections before ordinary routing and preserves their geometry", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: 0, y: -3, layer: "top" },
      { x: 10, y: -3, layer: "top" },
    ],
  })
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  expect(solver.pipelineDef.slice(0, 2).map((step): string => step.solverName)).toEqual([
    "preprocessSimpleRouteJsonSolver",
    "lengthMatchingPostProcessingSolver",
  ])
  solver.solveUntilPhase("componentDetectionSolver")
  expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
  const earlyRoutes = structuredClone(
    solver.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes,
  )
  expect(new Set(earlyRoutes.map((route): string => route.rootConnectionName ?? route.connectionName))).toEqual(new Set(["a", "b"]))
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const finalRoutes = solver._getOutputHdRoutes()
  for (const earlyRoute of earlyRoutes) {
    expect(finalRoutes.find((route): boolean => route.connectionName === earlyRoute.connectionName)).toEqual(earlyRoute)
  }
  expect(finalRoutes.some((route): boolean => (route.rootConnectionName ?? route.connectionName) === "ordinary")).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces?.find((trace): boolean => trace.pcb_trace_id === "fixed")).toEqual(input.traces![0])
  expect(new Set(solver.getOutputSimplifiedPcbTraces().map((trace): string | undefined => trace.connection_name))).toEqual(new Set(["a", "b", "ordinary"]))
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 hands early length-matched routes to native trace routing", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.connections.push({
    name: "ordinary",
    pointsToConnect: [
      { x: 5, y: -3, layer: "top", pcb_port_id: "ordinary_start" },
      { x: 5, y: 4, layer: "top", pcb_port_id: "ordinary_end" },
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
  expect(solver.preloadedTraceGraphSolver!.stats.preloadedTraceCount).toBe(3)
  expect(input).toEqual(original)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(new Set(routedTraces.map((trace) => trace.connection_name))).toEqual(
    new Set(["a", "b", "ordinary"]),
  )
  expect(new Set(routedTraces.map((trace) => trace.pcb_trace_id)).size).toBe(
    routedTraces.length,
  )
  // Later native routing must not break the early bus match.
  const [aLength, bLength] = ["a", "b"].map((connectionName): number =>
    routedTraces
      .filter((trace) => trace.connection_name === connectionName)
      .reduce((length, trace): number => {
        const wires = trace.route.filter((point) => point.route_type === "wire")
        return wires.slice(1).reduce((wireLength, point, index): number => {
          const previous = wires[index]!
          return (
            wireLength + Math.hypot(point.x - previous.x, point.y - previous.y)
          )
        }, length)
      }, 0),
  )
  expect(Math.abs(aLength! - bLength!)).toBeLessThanOrEqual(
    input.buses![0]!.maxLengthSkew! + 1e-6,
  )
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toHaveLength(0)
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 routes ordinary nets around length-matched SRJ traces", (): void => {
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
  solver.solveUntilPhase("componentDetectionSolver")
  expect(solver.earlyLengthMatchingSolver?.solved).toBe(true)
  expect(solver.earlyLengthMatchingSolver?.earlyLengthMatchingSolver).toBeUndefined()
  expect(solver.srj.traces).toHaveLength(3)
  expect(solver.srj.obstacles).toHaveLength(input.obstacles.length)
  expect(solver.srj.connections.map((connection) => connection.name)).toEqual(["ordinary"])
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.preloadedTraceGraphSolver!.stats.preloadedTraceCount).toBe(3)
  expect(input).toEqual(original)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.map((trace) => trace.connection_name).sort()).toEqual(["a", "b", "ordinary"])
  expect(new Set(traces.map((trace) => trace.pcb_trace_id)).size).toBe(traces.length)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.connections).toEqual(input.connections)
  expect(output.buses).toEqual(input.buses)
  expect(output.traces).toHaveLength(4)
  expect(output.traces!.find((trace) => trace.pcb_trace_id === "fixed")).toEqual(input.traces![0])
  const lengths = ["a", "b"].map((name): number => {
    const wires = traces.find((trace) => trace.connection_name === name)!.route
      .filter((point) => point.route_type === "wire")
    return wires.slice(1).reduce((length, point, index): number => {
      const previous = wires[index]!
      return length + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)
  })
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1 + 1e-6)
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }).errors).toHaveLength(0)
})

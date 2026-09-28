import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 matches buses once without changing early differential pair routes", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  for (const [name, y] of [
    ["pair_p", -2],
    ["pair_n", -2.5],
  ] as const) {
    input.connections.push({
      name,
      pointsToConnect: [
        { x: 0, y, layer: "top", pcb_port_id: `${name}_start` },
        { x: 10, y, layer: "top", pcb_port_id: `${name}_end` },
      ],
    })
    for (const point of input.connections.at(-1)!.pointsToConnect) {
      input.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [point.pcb_port_id!],
        circuitJsonMetadata: { pcb_port_id: point.pcb_port_id },
      })
    }
  }
  input.differentialPairs = [
    {
      connectionNames: ["pair_p", "pair_n"],
      lengthTolerance: 0.05,
      traceGap: 0.35,
    },
  ]
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  expect(
    solver.pipelineDef.filter(
      (step) => step.solverName === "lengthMatchingPostProcessingSolver",
    ),
  ).toHaveLength(1)
  solver.solveUntilPhase("componentDetectionSolver")
  const earlyTraces = structuredClone(
    solver.differentialPairRoutingSolver!.getOutput().routedTraces,
  )
  const earlyIterations = solver.differentialPairRoutingSolver!.iterations
  expect(earlyTraces).toHaveLength(2)

  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.differentialPairRoutingSolver!.iterations).toBe(earlyIterations)
  expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  for (const trace of earlyTraces) {
    expect(
      traces.find((candidate) => candidate.pcb_trace_id === trace.pcb_trace_id),
    ).toEqual(trace)
  }
  const busRoutes = solver._getOutputHdRoutes()
  expect(busRoutes).toHaveLength(2)
  const lengths = busRoutes.map((route): number =>
    route.route.slice(1).reduce((length, point, index): number => {
      const previous = route.route[index]!
      return length + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0),
  )
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1 + 1e-6)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toHaveLength(0)
})

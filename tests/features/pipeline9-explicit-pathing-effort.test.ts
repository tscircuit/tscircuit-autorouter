import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("an explicit pathing budget grows native search without changing cleanup effort", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    {
      layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
      obstacles: [-2, 2].map(x => ({ type: "rect", center: { x, y: 0 }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["signal"], circuitJsonMetadata: { pcb_port_id: x < 0 ? "pcb_port_left" : "pcb_port_right" } })),
      connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_left" }, { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_right" }] }],
    } as SimpleRouteJson,
    { effort: 1, pathingEffort: 8, cacheProvider: null } as any,
  )
  while (solver.getCurrentPhase() !== "portPointPathingSolver" && !solver.failed && !solver.solved) solver.step()
  expect(solver.failed).toBe(false)
  const stage = solver.pipelineDef.find(stage => stage.solverName === "portPointPathingSolver")!
  const params = stage.getConstructorParams(solver) as Array<{ effort: number }>
  expect(params[0].effort).toBe(8)
  expect(solver.effort).toBe(1)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces().length).toBeGreaterThan(0)
  const input = solver.originalSrj
  const routes = solver.getOutputSimplifiedPcbTraces()
  for (const pathingEffort of [undefined, 100]) {
    const next = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1, pathingEffort, cacheProvider: null })
    while (next.getCurrentPhase() !== "portPointPathingSolver" && !next.failed && !next.solved) next.step()
    expect(next.failed).toBe(false)
    next.step()
    const child = next.portPointPathingSolver!
    expect(next.MAX_ITERATIONS).toBeGreaterThanOrEqual(next.iterations + child.MAX_ITERATIONS)
    next.solve()
    expect(next.solved).toBe(true)
    expect(next.getOutputSimplifiedPcbTraces()).toEqual(routes)
  }
  for (const pathingEffort of [0, -1, NaN, Infinity]) {
    expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { pathingEffort })).toThrow("pathingEffort must be a finite positive number")
  }
})

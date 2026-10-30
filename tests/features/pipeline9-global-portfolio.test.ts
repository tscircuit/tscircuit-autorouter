import { expect, test } from "bun:test"

import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("global routing portfolio produces complete DRC-clean routes with four workers", async (): Promise<void> => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: Array.from({ length: 100 }, (_, i) => {
      const x = i < 50 ? -14 : 4
      const y = -50 + (i % 50) * 2
      return [x, x + 8].map((px, j) => ({ type: "rect" as const, layers: ["top"], center: { x: px, y }, width: 0.8, height: 0.8, connectedTo: [`net${i}`, `port${i}_${j}`] }))
    }).flat(),
    bounds: { minX: -20, maxX: 20, minY: -60, maxY: 60 },
    connections: Array.from({ length: 100 }, (_, i) => {
      const x = i < 50 ? -14 : 4
      const y = -50 + (i % 50) * 2
      return { name: `net${i}`, pointsToConnect: [
        { x, y, layer: "top", pointId: `port${i}_0`, pcb_port_id: `port${i}_0` }, { x: x + 8, y, layer: "top", pointId: `port${i}_1`, pcb_port_id: `port${i}_1` },
      ] }
    }),
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), { effort: 0.1, cacheProvider: null })
  await import("../../scripts/build-solver-workers")
  const { createAutorouterSolverRuntime } = await import("lib/runtime/bun")
  const runtime = createAutorouterSolverRuntime({ workerCount: 4, requireWorker: true })
  try {
    await solver.solveAsync(runtime)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.portPointPathingSolver?.portfolioCandidatesDispatched).toBe(4)
    expect(solver.portPointPathingSolver?.portfolioCandidatesSolved).toBe(4)
    const result = solver.getOutputSimpleRouteJson()
    expect(result.traces?.length).toBe(100)
    const drc = evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: srj, routedTraces: result.traces ?? [] })
    expect(drc.errors).toHaveLength(0)
  } finally {
    await runtime.dispose()
  }
})

import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"

test("all repair stages receive the same default hole clearance as the reference checker", (): void => {
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [{ type: "rect", shape: "circle", isNonPlatedHole: true,
      center: { x: 0, y: 0 }, width: 2, height: 2, layers: ["top", "bottom"], connectedTo: [] }],
    connections: [{ name: "signal", pointsToConnect: [
      { x: -2, y: 1.2, layer: "top", pcb_port_id: "a" },
      { x: 2, y: 1.2, layer: "top", pcb_port_id: "b" },
    ] }] }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
  const routes = [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -2, y: 1.2, z: 0 }, { x: 2, y: 1.2, z: 0 }], vias: [] }]
  expect(getFixedObstacleViolations({ srj: { ...solver.srj, traces: undefined }, routes })).toHaveLength(1)
  expect(solver.originalSrj.minTraceToHoleEdgeClearance).toBe(0.2)
  expect(srj.minTraceToHoleEdgeClearance).toBeUndefined()
  const explicit = new AutoroutingPipelineSolver9_PreloadedTraceGraph({ ...srj,
    minTraceToHoleEdgeClearance: 0.07 }, { cacheProvider: null })
  expect(explicit.srj.minTraceToHoleEdgeClearance).toBe(0.07)
  const noHoles = new AutoroutingPipelineSolver9_PreloadedTraceGraph({ ...srj,
    obstacles: [] }, { cacheProvider: null })
  expect(noHoles.srj.minTraceToHoleEdgeClearance).toBeUndefined()
})

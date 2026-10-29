import { expect, test } from "bun:test"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"

test("path sections retain explicit widths, identity metadata and through-obstacle copper", () => {
  const routes = [{ connectionName: "anchors", traceThickness: 0.1, viaDiameter: 0.3, vias: [{ x: 2, y: 0 }], route: [
    { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    { x: 1, y: 0, z: 0, traceThickness: 0.4 },
    { x: 2, y: 0, z: 0, toNextSegmentType: "through_obstacle" as const },
    { x: 3, y: 0, z: 0, pcb_port_id: "through-pad" },
    { x: 4, y: 0, z: 0, pcb_port_id: "end" },
  ] }]
  const original = structuredClone(routes)
  const solver = new Pipeline9LayerPreservingPathSolver({ unsimplifiedHdRoutes: routes, obstacles: [] })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.simplifiedHdRoutes[0]!.route).toEqual(original[0]!.route)
  expect(solver.simplifiedHdRoutes[0]!.vias).toEqual(original[0]!.vias)
  expect(routes).toEqual(original)
})

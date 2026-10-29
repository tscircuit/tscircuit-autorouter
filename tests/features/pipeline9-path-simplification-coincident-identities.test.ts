import { expect, test } from "bun:test"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"

test("coincident source points with different identities remain distinct anchors", () => {
  const route = { connectionName: "coincident-identities", traceThickness: 0.1, viaDiameter: 0.3, vias: [], route: [
    { x: 0, y: 0, z: 0, pcb_port_id: "left-port" },
    { x: 0, y: 0, z: 0, pcb_port_id: "right-port" },
  ] }
  const solver = new Pipeline9LayerPreservingPathSolver({ unsimplifiedHdRoutes: [route], obstacles: [] })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.simplifiedHdRoutes[0]!.route).toEqual(route.route)
})

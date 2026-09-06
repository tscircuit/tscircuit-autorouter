import { expect, test } from "bun:test"
import { Pipeline9PostRepairTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9PostRepairTraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 post-repair simplification removes only redundant copper", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 3, y: 2, z: 0, pcb_port_id: "end" },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    jumpers: [],
  }
  const solver = new Pipeline9PostRepairTraceSimplificationSolver({
    hdRoutes: [
      inputRoute,
      {
        ...inputRoute,
        connectionName: "closed-same-position-endpoints",
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.simplifiedHdRoutes).toEqual([
    {
      ...inputRoute,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "start" },
        { x: 2, y: 2, z: 0 },
        { x: 3, y: 2, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
    },
    {
      ...inputRoute,
      connectionName: "closed-same-position-endpoints",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      vias: [],
    },
  ])
  expect(solver.stats).toEqual({
    inputPointCount: 11,
    outputPointCount: 6,
    inputViaCount: 2,
    outputViaCount: 0,
  })
})

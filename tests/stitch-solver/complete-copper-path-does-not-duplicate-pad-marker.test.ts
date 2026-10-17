import { expect, test } from "bun:test"
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"

test("a complete copper path does not retain its redundant one-point pad marker", (): void => {
  const connection: SimpleRouteConnection = {
    name: "signal",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "pad-a" },
      { x: 1, y: 0, layer: "top", pcb_port_id: "pad-b" },
    ],
  }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [connection],
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.2,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        startPcbPortId: "pad-a",
        endPcbPortId: "pad-b",
        vias: [],
      },
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.2,
        route: [{ x: 1, y: 0, z: 0 }],
        startPcbPortId: "pad-b",
        endPcbPortId: "pad-b",
        vias: [],
      },
    ],
    layerCount: 2,
    enableCompleteTerminalStitching: true,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(() =>
    lockHdRouteTerminals({
      hdRoutes: solver.mergedHdRoutes,
      connections: [connection],
    }),
  ).not.toThrow()
})

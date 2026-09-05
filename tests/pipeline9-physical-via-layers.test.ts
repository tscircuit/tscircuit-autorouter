import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 joint repair detects collisions on explicitly occupied via layers", () => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "power",
      traceThickness: 0.12,
      viaDiameter: 0.2,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "power_start" },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1, pcb_port_id: "power_end" },
      ],
    },
    {
      connectionName: "signal",
      traceThickness: 0.12,
      viaDiameter: 0.2,
      vias: [],
      route: [
        { x: 0, y: -1, z: 3, pcb_port_id: "signal_start" },
        { x: 0, y: 1, z: 3, pcb_port_id: "signal_end" },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaDiameter: 0.2,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "power",
        pointsToConnect: [
          {
            x: -1,
            y: 0,
            layer: "top",
            pcb_port_id: "power_start",
          },
          {
            x: 1,
            y: 0,
            layer: "inner1",
            pcb_port_id: "power_end",
          },
        ],
      },
      {
        name: "signal",
        pointsToConnect: [
          {
            x: 0,
            y: -1,
            layer: "bottom",
            pcb_port_id: "signal_start",
          },
          {
            x: 0,
            y: 1,
            layer: "bottom",
            pcb_port_id: "signal_end",
          },
        ],
      },
    ],
  }
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const originalSrj = { ...srj, allowBlindAndBuriedVias }
    const solver = new Pipeline9JointDrcRepairSolver({
      srj: originalSrj,
      srjWithPointPairs: originalSrj,
      originalSrj,
      newConnections: srj.connections,
      newHdRoutes: routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: [],
      layerCount: 4,
      defaultViaDiameter: 0.2,
      defaultViaHoleDiameter: 0.1,
      effort: 1,
      colorMap: {},
    })
    expect(solver.stats.initialJointDrcIssueCount > 0).toBe(
      allowBlindAndBuriedVias === false,
    )
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
  }
})

import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair honors default and explicit non-plated hole clearance", (): void => {
  for (const holeClearance of [undefined, 0.3]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      defaultObstacleMargin: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      minTraceToHoleEdgeClearance: holeClearance,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [{
        name: "signal",
        pointsToConnect: [
          { x: -2, y: -0.7, layer: "top", pointId: "a", pcb_port_id: "a" },
          { x: 2, y: -0.7, layer: "top", pointId: "b", pcb_port_id: "b" },
        ],
      }],
      obstacles: [{
        obstacleId: "mounting-hole",
        type: "rect",
        shape: "circle",
        isNonPlatedHole: true,
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: [],
      }],
    }
    const original = structuredClone(srj)
    const routes: HighDensityRoute[] = [{
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      startPcbPortId: "a",
      endPcbPortId: "b",
      route: [
        { x: -2, y: -0.7, z: 0, pcb_port_id: "a" },
        { x: 0, y: -0.7, z: 0 },
        { x: 2, y: -0.7, z: 0, pcb_port_id: "b" },
      ],
    }]
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const solver = new Pipeline9JointDrcRepairSolver({
      srj, srjWithPointPairs: srj, originalSrj: srj,
      newConnections: srj.connections, newHdRoutes: routes,
      updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
      connMap, obstacles: srj.obstacles, layerCount: 2,
      defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15,
      effort: 1, colorMap: {},
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const output = solver.getOutput()
    const drc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections, originalConnections: srj.connections,
        hdRoutes: output, layerCount: 2, obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.15, connMap,
      }),
    })
    expect(drc.errors).toEqual([])
    expect(output[0]!.route[0]).toEqual(routes[0]!.route[0])
    expect(output[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
    expect(srj).toEqual(original)
  }
})

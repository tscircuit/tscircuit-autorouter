import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair handles same-net pad drills even when electrical DRC is clean", (): void => {
  for (const allowViaInPad of [false, undefined, true]) {
    for (const x of [0.25, 0.3, 0.31]) {
      const srj: SimpleRouteJson = {
        layerCount: 2,
        minTraceWidth: 0.1,
        minViaDiameter: 0.6,
        minViaHoleDiameter: 0.2,
        allowViaInPad,
        bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
        obstacles: [
          {
            type: "rect",
            shape: "circle",
            center: { x: 0, y: 0 },
            width: 0.4,
            height: 0.4,
            layers: ["top"],
            connectedTo: ["signal", "start"],
            circuitJsonMetadata: { pcb_smtpad_id: "signal_pad" },
          },
        ],
        connections: [
          {
            name: "signal",
            pointsToConnect: [
              { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
              { x: 2, y: 1, layer: "bottom", pcb_port_id: "end" },
            ],
          },
        ],
      }
      const routes: HighDensityRoute[] = [
        {
          connectionName: "signal",
          traceThickness: 0.1,
          viaDiameter: 0.6,
          vias: [{ x, y: 0 }],
          route: [
            { x: 0, y: 0, z: 0, pcb_port_id: "start" },
            { x, y: 0, z: 0 },
            { x, y: 0, z: 1 },
            { x: 2, y: 1, z: 1, pcb_port_id: "end" },
          ],
        },
      ]
      const original = structuredClone(routes)
      const solver = new Pipeline9JointDrcRepairSolver({
        srj,
        srjWithPointPairs: srj,
        originalSrj: srj,
        newConnections: srj.connections,
        newHdRoutes: routes,
        updatedPreloadedTraces: [],
        mutatedPreloadedTraceIds: new Set(),
        connMap: getConnectivityMapFromSimpleRouteJson(srj),
        obstacles: srj.obstacles,
        layerCount: 2,
        defaultViaDiameter: 0.6,
        defaultViaHoleDiameter: 0.2,
        effort: 1,
        colorMap: {},
      })
      expect(solver.stats.initialJointDrcIssueCount).toBe(0)
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      const json = convertToCircuitJson(srj, solver.getOutput())
      const forbiddenDrills = checkViasInPads(json)
      if (allowViaInPad === true && x === 0.25) {
        expect(forbiddenDrills).toHaveLength(1)
        expect(solver.getOutput()).toEqual(original)
      } else {
        expect(forbiddenDrills).toEqual([])
      }
      expect(routes).toEqual(original)
    }
  }
})

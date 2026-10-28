import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("ordinary endpoint-via fast paths validate the actual transition before searching a legal remote via", (): void => {
  const physical = {
    connMap: new ConnectivityMap({}), layerCount: 4, traceClearance: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1, viaToPadClearance: 0.1,
    boardObstacles: [{ type: "rect" as const, center: { x: 0, y: 0 }, width: 0.4, height: 0.4,
      layers: ["top"], connectedTo: [] }],
  }
  const validate = (route: HighDensityIntraNodeRoute): boolean =>
    arePipeline9NativeRoutesPhysicallyValid({ ...physical, routes: [route] })
  const solver = new IntraNodeRouteSolver({ nodeWithPortPoints: {
    capacityMeshNodeId: "inner-endpoint-via", center: { x: 0, y: 0 }, width: 2, height: 2,
    availableZ: [1, 3], portPoints: [
      { x: 0, y: 0, z: 1, connectionName: "signal" }, { x: 0, y: 0, z: 3, connectionName: "signal" },
    ],
  }, traceWidth: 0.1, viaDiameter: 0.3, routeFragmentValidator: validate })
  solver.step()
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.activeSubSolver).not.toBeNull()
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.solvedRoutes).toHaveLength(1)
  expect(solver.solvedRoutes[0]!.vias.length).toBeGreaterThan(0)
  expect(validate(solver.solvedRoutes[0]!)).toBeTrue()
  expect(solver.solvedRoutes[0]!.vias.every((via) => via.x !== 0 || via.y !== 0)).toBeTrue()
})

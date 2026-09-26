import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9NodeSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NodeSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const createNodeSimplification = (
  overrides: Partial<ConstructorParameters<typeof Pipeline9NodeSimplificationSolver>[0]> = {},
): Pipeline9NodeSimplificationSolver => new Pipeline9NodeSimplificationSolver({
  node: { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 10, height: 10, portPoints: [] },
  routes: [createShortcutRoute()], obstacles: [], connMap: new ConnectivityMap({}), layerCount: 2, clearance: 0.2,
  ...overrides,
})

export const createShortcutRoute = (): HighDensityRoute => ({
  connectionName: "a", regionId: "node", startPcbPortId: "start", endPcbPortId: "end",
  traceThickness: 0.2, viaDiameter: 0.6, vias: [],
  route: [{ x: -4, y: 0, z: 0 }, { x: -2, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 4, y: 0, z: 0 }],
})

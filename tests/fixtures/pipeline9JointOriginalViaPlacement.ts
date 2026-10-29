import { checkViaPadClearance, checkViasOffBoard } from "@tscircuit/checks"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types/srj-types"

type JointParams = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type FixtureKind = "board" | "foreign-pad" | "own-pad"

export type JointOriginalViaPlacementFixture = {
  params: JointParams
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
}

export const makeJointOriginalViaPlacementFixture = (
  kind: FixtureKind,
): JointOriginalViaPlacementFixture => {
  const y = kind === "board" ? 0.07 : 0
  const endpoints: SimpleRouteConnection["pointsToConnect"] = [
    { x: -1, y, layer: "inner1", pcb_port_id: "a" },
    { x: 1, y, layer: "inner2", pcb_port_id: "b" },
  ]
  const signal: SimpleRouteConnection = { name: "signal", pointsToConnect: endpoints }
  const padPoint: SimpleRouteConnection["pointsToConnect"][number] = {
    x: kind === "own-pad" ? 0 : 0.3, y: 0, layer: "top", pcb_port_id: "pad-port",
  }
  const originalSrj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1, minViaDiameter: 0.3, minViaHoleDiameter: 0.15,
    minBoardEdgeClearance: 0, minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 2, minY: kind === "board" ? 0 : -2, maxY: 3 },
    connections: kind === "own-pad"
      ? [{ ...signal, pointsToConnect: [...endpoints, padPoint] }]
      : [signal, ...(kind === "foreign-pad" ? [{ name: "pad-owner", pointsToConnect: [padPoint] }] : [])],
    obstacles: kind === "board" ? [] : [{ type: "rect", center: { x: padPoint.x, y: 0 },
      width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["pad-port"],
      circuitJsonMetadata: { pcb_smtpad_id: "original_pad_with_under_scores", pcb_port_id: "pad-port" } }],
  }
  const srjWithPointPairs: SimpleRouteJson = { ...structuredClone(originalSrj), connections: [structuredClone(signal)] }
  const route: HighDensityRoute = {
    connectionName: "signal", rootConnectionName: "signal", traceThickness: 0.1,
    viaDiameter: 0.3, startPcbPortId: "a", endPcbPortId: "b",
    route: [{ x: -1, y, z: 1, pcb_port_id: "a" }, { x: -0.8, y, z: 1 },
      { x: 0, y, z: 1 }, { x: 0, y, z: 2 }, { x: 0.8, y, z: 2 },
      { x: 1, y, z: 2, pcb_port_id: "b" }], vias: [{ x: 0, y }],
  }
  const netMap: Record<string, string[]> = kind === "own-pad"
    ? { signal: ["signal", "a", "b", "pad-port"] }
    : { signal: ["signal", "a", "b"], "pad-owner": ["pad-owner", "pad-port"] }
  return { originalSrj, srjWithPointPairs, params: {
    srj: structuredClone(originalSrj), srjWithPointPairs, originalSrj,
    newConnections: srjWithPointPairs.connections, newHdRoutes: [route],
    updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(), connMap: new ConnectivityMap(netMap),
    obstacles: originalSrj.obstacles, layerCount: 4, defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  } }
}

export const evaluateJointOriginalViaPlacement = (
  fixture: JointOriginalViaPlacementFixture,
  routes: HighDensityRoute[],
): {
  reference: ReturnType<typeof evaluateRelaxedDrc>
  board: ReturnType<typeof checkViasOffBoard>
  pad: ReturnType<typeof checkViaPadClearance>
} => {
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: fixture.srjWithPointPairs.connections,
    originalConnections: fixture.originalSrj.connections,
    hdRoutes: routes, layerCount: fixture.originalSrj.layerCount,
    obstacles: fixture.originalSrj.obstacles, defaultViaHoleDiameter: 0.15,
    connMap: fixture.params.connMap,
  })
  const reference = evaluateRelaxedDrc({ inputSrj: fixture.originalSrj,
    srjWithPointPairs: fixture.srjWithPointPairs, routedTraces: traces, includeBoardClearance: true })
  return { reference, board: checkViasOffBoard(reference.circuitJson),
    pad: checkViaPadClearance(reference.circuitJson, {
      minClearance: fixture.originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1,
    }) }
}

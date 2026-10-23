import { expect, test } from "bun:test"
import { Pipeline9ElectricalTreeRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ElectricalTreeRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("whole-branch search preserves plated-hole and jumper primitives and leaves their unresolved issues visible", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }],
    electricalBranch: { netId: "ab", startVertexId: "A", endVertexId: "B", logicalConnectionNames: ["ab"] } }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections: [connection] }
  for (const protectedGeometry of [
    { point: { toNextSegmentType: "through_obstacle" as const }, jumpers: undefined },
    { point: { insideJumperPad: true }, jumpers: undefined },
    { point: {}, jumpers: [{ route_type: "jumper" as const, start: { x: -0.2, y: 0 }, end: { x: 0.2, y: 0 }, footprint: "0603" as const }] },
  ]) {
    const route: HighDensityRoute = { connectionName: "ab", rootConnectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 0, y: 0, z: 0, ...protectedGeometry.point }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [], jumpers: protectedGeometry.jumpers }
    const solver = new Pipeline9ElectricalTreeRepairSolver({ srj, preloadedTraces: srj.traces ?? [], routes: [route], newConnections: [connection], fixedObstacleRoutes: [],
      syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(), connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.1, obstacleMargin: 0.1, traceClearance: 0.1, viaClearance: 0.1, viaHoleClearance: 0.1, effort: 1,
      drcEvaluator: () => ({ errors: [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "retained-protected-issue" }] }) })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.getOutput()).toEqual([route])
    expect(solver.stats.electricalTreeWholeBranchTrials).toBe(0)
    expect(solver.stats.electricalTreeWholeBranchProtectedRoutes).toBe(1)
    expect(solver.stats.electricalTreeWholeBranchFinalIssues).toBe(1)
  }
})

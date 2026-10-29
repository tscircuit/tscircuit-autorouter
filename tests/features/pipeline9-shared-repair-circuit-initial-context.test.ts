import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createCleanSharedRepairCandidate, createSharedRepairGeometryInput, type SharedRepairEvaluatorAccess } from "../fixtures/shared-repair-geometry-input"

test("initial baseline/current repair checks share normalized connectivity while later reference maps retain their separate native scope", (): void => {
  for (const separatePointPairObject of [false, true]) {
    const solvers = [undefined, false, true].map((enabled) => {
      const params = createSharedRepairGeometryInput(enabled)
      for (const connection of params.originalSrj.connections) {
        for (const [index, point] of connection.pointsToConnect.entries()) {
          delete point.pcb_port_id
          params.originalSrj.obstacles.push({
            type: "rect",
            obstacleId: point.pointId,
            center: { x: point.x, y: point.y },
            width: 0.4,
            height: 0.4,
            layers: ["top"],
            connectedTo: [connection.name],
            circuitJsonMetadata: {
              source_component_name: connection.name,
              source_port_name: String(index),
              pcb_smtpad_id: `imported_${point.pointId}`,
            },
          })
        }
      }
      if (separatePointPairObject) params.srjWithPointPairs = { ...params.originalSrj }
      params.connMap = getConnectivityMapFromSimpleRouteJson(params.originalSrj)
      return new Pipeline9JointDrcRepairSolver(params)
    })
    expect(solvers[1]!.stats).toEqual(solvers[0]!.stats)
    expect(solvers[2]!.stats).toEqual(solvers[0]!.stats)
    expect(solvers[2]!.sharedRepairCircuitStats).toMatchObject({
      contextBuilds: 1,
      conversions: 2,
      sourceConnectivityBuilds: 1,
      routeConnectivityBuilds: 1,
      sourceConnectivityReuses: 1,
    })
    const candidate = createCleanSharedRepairCandidate(solvers[0]!.inputNewHdRoutes)
    const values = solvers.map((solver) => (solver as unknown as SharedRepairEvaluatorAccess)
      .cachedReferenceDrcEvaluator({ traces: [], routes: candidate }))
    expect(values[1]).toEqual(values[0])
    expect(values[2]).toEqual(values[0])
    expect(solvers[2]!.sharedRepairCircuitStats).toMatchObject({
      contextBuilds: 2,
      conversions: 3,
      sourceConnectivityBuilds: 1,
      routeConnectivityBuilds: 1,
      sourceConnectivityReuses: 1,
    })
    for (const solver of solvers) solver.solve()
    expect(solvers[1]!.getOutput()).toEqual(solvers[0]!.getOutput())
    expect(solvers[2]!.getOutput()).toEqual(solvers[0]!.getOutput())
    expect(solvers[2]!.sharedRepairCircuitStats!.contextBuilds).toBe(2)
  }
})

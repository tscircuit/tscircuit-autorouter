import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { FrontierIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/FrontierIntraNodeSolver"

test("Pipeline9 passes the actual drill diameter and hole gap to the ordinary graph candidate", () => {
  const phase = new Pipeline9HighDensitySolver({
    nodePortPoints: [{
      capacityMeshNodeId: "drill-rule", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1, 2, 3],
      portPoints: [
        { connectionName: "a", rootConnectionName: "root", x: -0.1, y: 0, z: 0 },
        { connectionName: "a", rootConnectionName: "root", x: -0.1, y: 0, z: 3 },
        { connectionName: "b", rootConnectionName: "root", x: 0.1, y: 0, z: 0 },
        { connectionName: "b", rootConnectionName: "root", x: 0.1, y: 0, z: 3 },
      ],
    }], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 4,
    viaDiameter: 0.3, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.2,
    traceWidth: 0.1, obstacleMargin: 0.1, effort: 1,
  })
  phase.step()
  const regular = phase.activeRegularSolver!
  expect(regular.viaHoleDiameter).toBe(0.2)
  expect(regular.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
  regular.step()
  const growShrink = regular.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  growShrink.step()
  const portfolio = growShrink.activeSubSolver ?? growShrink.winningSolver!
  if (!portfolio.supervisedSolvers) portfolio.initializeSolvers()
  const graph = portfolio.supervisedSolvers!.find(({ solver }) => solver instanceof FrontierIntraNodeSolver)!.solver as FrontierIntraNodeSolver
  expect(graph.viaHoleDiameter).toBe(0.2)
  expect(graph.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
  expect(graph.validationSrj.minViaHoleDiameter).toBe(0.2)
  expect(graph.validationSrj.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
})

import { expect, test } from "bun:test"
import { createPipeline9RegularNodeSolverFromCanonicalNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("the owned native factory vetoes a candidate sharing only a rounded routing group", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      { name: "signal", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "signal-port" }] },
      { name: "ground", pointsToConnect: [{ x: 0.004, y: 0, layer: "top", pcb_port_id: "ground-port" }] },
    ], obstacles: [],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj, routingConnMap: connMap })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "rounded-owner-node", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "signal" }, { x: 2, y: 0, z: 0, connectionName: "signal" },
      { x: -2, y: 0.1, z: 0, connectionName: "ground" }, { x: 2, y: 0.1, z: 0, connectionName: "ground" },
    ],
  }
  const highDensity = createPipeline9RegularNodeSolverFromCanonicalNode({
    nodeWithPortPoints: node, connMap, physicalOwnership, physicalBoardObstacles: originalSrj.obstacles,
    colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.15,
    traceWidth: 0.1, obstacleMargin: 0.15, effort: 1, nodePfById: {},
    obstacles: [], layerCount: 4, priorityDagSearch: true, cacheProvider: null,
  })
  highDensity.step()
  const growShrink = highDensity.activeSubSolver!
  Reflect.get(growShrink, "createActiveSubSolver").call(growShrink)
  const portfolio = Reflect.get(growShrink, "activeSubSolver") as PortfolioSingleIntraNodeSolver
  const provisional = new IntraNodeRouteSolver({ nodeWithPortPoints: node })
  provisional.solvedRoutes = ["signal", "ground"].map((connectionName) => ({
    connectionName, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [],
  }))
  provisional.solved = true
  portfolio.solved = true
  portfolio.onSolve({ solver: provisional, hyperParameters: {}, h: 0, g: 0, f: 0 })
  expect(provisional.failed).toBeTrue()
  expect(portfolio.solved).toBeFalse()
  expect(portfolio.stats.physicalCandidateRejectionCount).toBe(1)
  expect(highDensity.routes).toEqual([])
})

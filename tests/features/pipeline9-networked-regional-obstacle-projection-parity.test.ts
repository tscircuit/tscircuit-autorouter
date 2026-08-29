import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-regional-fallback-solver"
import {
  projectPipeline9OrdinaryHighDensityInput,
  projectPipeline9RegionalHighDensityInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-input-projection"
import type { Obstacle } from "lib/types/srj-types"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 regional obstacle projection matches the full board fallback solve", () => {
  const node = createNetworkedNode({
    nodeId: "cmn_regional_projection_parity",
    connectionName: "route_A",
    rootConnectionName: "root_A",
  })
  const noiseIds = Array.from({ length: 2_310 }, (_, index) => `noise_${index}`)
  const connMap = new ConnectivityMap({
    canonical_A: ["route_A", "root_A", "pad_A", ...noiseIds],
    foreign_net: ["foreign_A"],
  })
  const obstacles: Obstacle[] = [
    {
      obstacleId: "same_net_pad",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -2, y: 0 },
      width: 0.4,
      height: 0.4,
      ccwRotationDegrees: 15,
      connectedTo: ["pad_A", ...noiseIds],
    },
    {
      obstacleId: "nearby_foreign_pad",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 1.5 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["foreign_A"],
    },
    {
      obstacleId: "far_board_noise",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 100, y: 100 },
      width: 1,
      height: 1,
      connectedTo: ["foreign_A"],
    },
  ]
  const projection = projectPipeline9RegionalHighDensityInput({
    nodeWithPortPoints: node,
    connMap,
    obstacles,
    obstacleMargin: 0.15,
    traceWidth: 0.15,
    viaDiameter: 0.3,
  })
  const ordinaryFromFullBoard = projectPipeline9OrdinaryHighDensityInput({
    nodeWithPortPoints: node,
    connMap,
    colorMap: { route_A: "blue" },
    obstacles,
    obstacleMargin: 0.15,
    traceWidth: 0.15,
    viaDiameter: 0.3,
  })
  const ordinaryFromRegionalProjection =
    projectPipeline9OrdinaryHighDensityInput({
      nodeWithPortPoints: node,
      connMap,
      colorMap: { route_A: "blue" },
      obstacles: projection.obstacles,
      obstacleMargin: 0.15,
      traceWidth: 0.15,
      viaDiameter: 0.3,
    })
  const normalizedNode = {
    ...normalizePipeline9NodeRootConnectionNames(node, connMap),
    availableZ: [0, 1],
  }
  const createSolver = (
    projectedObstacles: Obstacle[],
    projectedConnMap: ConnectivityMap,
  ): Pipeline9RegionalFallbackSolver =>
    new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: normalizedNode,
      colorMap: { route_A: "blue" },
      connMap: projectedConnMap,
      viaDiameter: 0.3,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
      nodePfById: { cmn_regional_projection_parity: 0.1 },
      obstacles: projectedObstacles,
      layerCount: 2,
    })
  const fullSolver = createSolver(obstacles, connMap)
  const projectedSolver = createSolver(
    projection.obstacles,
    new ConnectivityMap(projection.connectivityNetMap),
  )

  fullSolver.solve()
  projectedSolver.solve()

  expect(projection.obstacles).toHaveLength(2)
  expect(ordinaryFromRegionalProjection).toEqual(ordinaryFromFullBoard)
  expect(JSON.stringify(projection)).not.toContain("noise_2309")
  expect(projectedSolver.solved).toBe(fullSolver.solved)
  expect(projectedSolver.failed).toBe(fullSolver.failed)
  expect(projectedSolver.error).toBe(fullSolver.error)
  expect(projectedSolver.getOutput()).toEqual(fullSolver.getOutput())
})

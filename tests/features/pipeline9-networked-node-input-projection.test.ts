import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouter-version"
import { projectPipeline9OrdinaryHighDensityInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-input-projection"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("Pipeline9 projects ordinary node inputs without changing the HTTP solve", async () => {
  const noiseIds = Array.from({ length: 2_310 }, (_, index) => `noise_${index}`)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_projected",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      {
        x: -0.2,
        y: 0,
        z: 0,
        connectionName: "route_A",
        rootConnectionName: "root_A",
        portPointId: "port_point_A0",
      },
      {
        x: 0.2,
        y: 0,
        z: 1,
        connectionName: "route_A",
        rootConnectionName: "root_A",
        portPointId: "port_point_A1",
      },
    ],
  }
  const connectedToWithBoardNoise = ["pcb_pad_A", ...noiseIds]
  const obstacles: Obstacle[] = [
    {
      obstacleId: "near_rotated_through_obstacle",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.1,
      ccwRotationDegrees: 90,
      connectedTo: connectedToWithBoardNoise,
      circuitJsonMetadata: { pcb_plated_hole_id: "plated_hole_A" },
    },
    {
      obstacleId: "eight_x_envelope_obstacle",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 3.9, y: 0 },
      width: 0.2,
      height: 0.2,
      connectedTo: connectedToWithBoardNoise,
    },
    {
      obstacleId: "overlapping_foreign_obstacle",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      connectedTo: ["foreign_route"],
    },
    {
      obstacleId: "far_same_net_obstacle",
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 100, y: 100 },
      width: 1,
      height: 1,
      connectedTo: connectedToWithBoardNoise,
    },
  ]
  const connMap = new ConnectivityMap({
    original_net_A: [
      "route_A",
      "root_A",
      "pcb_pad_A",
      "port_point_A0",
      "port_point_A1",
      "plated_hole_A",
    ],
    original_noise_net: noiseIds,
    original_foreign_net: ["foreign_route"],
  })
  const projection = projectPipeline9OrdinaryHighDensityInput({
    nodeWithPortPoints: node,
    connMap,
    colorMap: { route_A: "blue", foreign_route: "red" },
    obstacles,
    obstacleMargin: 0.15,
    traceWidth: 0.15,
    viaDiameter: 0.3,
  })

  expect(projection.obstacles.map((obstacle) => obstacle.center)).toEqual([
    { x: 0, y: 0 },
    { x: 3.9, y: 0 },
  ])
  expect(projection.obstacles.map((obstacle) => obstacle.connectedTo)).toEqual([
    ["route_A"],
    ["route_A"],
  ])
  expect(projection.obstacles[0]!.ccwRotationDegrees).toBeUndefined()
  expect(projection.obstacles[0]!.circuitJsonMetadata).toEqual({
    pcb_plated_hole_id: "plated_hole_A",
  })
  expect(projection.connectivityNetMap).toEqual({
    original_net_A: [
      "route_A",
      "root_A",
      "port_point_A0",
      "port_point_A1",
      "plated_hole_A",
    ],
  })
  expect(projection.colorMap).toEqual({ route_A: "blue" })

  const unprojectedJsonSize = JSON.stringify({
    node,
    connectivityNetMap: connMap.netMap,
    obstacles,
  }).length
  const projectedJsonSize = JSON.stringify({ node, ...projection }).length
  expect(projectedJsonSize).toBeLessThan(unprojectedJsonSize / 20)

  const fullInputSolver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: node,
    connMap,
    colorMap: { route_A: "blue", foreign_route: "red" },
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_projected: 0.1 },
  })
  fullInputSolver.solve()
  const projectedInput = {
    solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
    enableRegionalFallback: false,
    nodeWithPortPoints: node,
    connectivityNetMap: projection.connectivityNetMap,
    colorMap: projection.colorMap,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: projection.obstacles,
    regionalObstacles: [],
    layerCount: 2,
    nodePf: 0.1,
  } as const
  const server = new ExampleHdCache2Server()
  let projectedResult: Record<string, unknown>
  try {
    const response = await fetch(`${server.url}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        autorouterVersion: AUTOROUTER_VERSION,
        input: projectedInput,
      }),
    })
    expect(response.status).toBe(200)
    projectedResult = (await response.json()) as Record<string, unknown>
  } finally {
    await server.close()
  }

  expect(fullInputSolver.solved).toBeTrue()
  expect(projectedResult).toEqual({
    ok: true,
    autorouterVersion: AUTOROUTER_VERSION,
    source: "solver",
    status: "solved",
    solutionStage: "ordinary",
    routes: fullInputSolver.routes,
  })

  const localPipeline9Solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap,
    colorMap: { route_A: "blue", foreign_route: "red" },
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_projected: 0.1 },
    enableRegionalFallback: false,
  })
  localPipeline9Solver.step()
  // Projection is network-only; baseline Pipeline9 keeps its full local input.
  expect(localPipeline9Solver.activeRegularSolver?.obstacles).toEqual(obstacles)
  expect(localPipeline9Solver.activeRegularSolver?.connMap?.netMap).toEqual(
    connMap.netMap,
  )
})

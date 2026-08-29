import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  normalizePipeline9NodeRootConnectionNames,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { projectPipeline9OrdinaryHighDensityInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/project-pipeline9-ordinary-high-density-input"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solve-pipeline9-networked-high-density-node"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 projects ordinary node obstacles and connectivity without changing the solve", () => {
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

  const fullInputSolver = new HighDensitySolver({
    nodePortPoints: [normalizePipeline9NodeRootConnectionNames(node, connMap)],
    connMap,
    colorMap: { route_A: "blue", foreign_route: "red" },
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_projected: 0.1 },
    useGrowShrinkHighDensityIntraNodeSolver: true,
    preserveTerminalPcbPortIds: false,
    growShrinkFallbackToInvalidGeometryOnFailure: false,
    captureSearchDebug: false,
    enableHighDensityA08: true,
    enableHighDensityA01FineGrid: true,
  })
  fullInputSolver.solve()
  const projectedResult = solvePipeline9NetworkedHighDensityNode({
    nodeWithPortPoints: node,
    connectivityNetMap: projection.connectivityNetMap,
    colorMap: projection.colorMap,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: projection.obstacles,
    layerCount: 2,
    nodePf: 0.1,
  })

  expect(fullInputSolver.solved).toBeTrue()
  expect(projectedResult).toEqual({
    status: "solved",
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
  expect(localPipeline9Solver.activeRegularSolver?.obstacles).toEqual(
    projection.obstacles,
  )
  expect(localPipeline9Solver.activeRegularSolver?.connMap?.netMap).toEqual(
    projection.connectivityNetMap,
  )
})

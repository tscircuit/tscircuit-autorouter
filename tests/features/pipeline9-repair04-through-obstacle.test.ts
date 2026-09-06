import { expect, test } from "bun:test"
import { getRepairViaGeometry } from "@tscircuit/repair04"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 preserves a real through-obstacle route while repairing nearby copper", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const obstacle = {
    type: "rect" as const,
    center: { x: 0, y: 3 },
    width: 1,
    height: 1,
    layers: ["top", "bottom"],
    connectedTo: [
      "through",
      "pcb_plated_hole_through",
      "pcb_port_through_hole",
    ],
    circuitJsonMetadata: {
      pcb_plated_hole_id: "pcb_plated_hole_through",
      pcb_port_id: "pcb_port_through_hole",
    },
  }
  const portPoints = [
    { x: -0.2, y: 3, z: 0, connectionName: "through" },
    { x: 0.2, y: 3, z: 1, connectionName: "through" },
  ]
  const intraNode = new SingleTransitionThroughObstacleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "repair04-through-obstacle",
      center: { x: 0, y: 3 },
      width: 1,
      height: 1,
      portPoints,
      portPointsInPairs: [[portPoints[0]!, portPoints[1]!]],
    },
    obstacles: [obstacle],
    layerCount: 2,
  })
  expect(intraNode.solved).toBe(true)
  // The real intra-node output is stitched to ordinary terminal wires.
  const atomicRoute = {
    ...intraNode.solvedRoutes[0]!,
    route: [
      { x: -2, y: 3, z: 0, pcb_port_id: "pcb_port_through_start" },
      ...intraNode.solvedRoutes[0]!.route,
      { x: 2, y: 3, z: 1, pcb_port_id: "pcb_port_through_end" },
    ],
  }
  fixture.hdRoutes.push(atomicRoute)
  fixture.srj.obstacles.push(obstacle)
  fixture.srj.connections.push({
    name: "through",
    pointsToConnect: [atomicRoute.route[0]!, atomicRoute.route.at(-1)!].map(
      (point) => ({
        x: point.x,
        y: point.y,
        layer: point.z === 0 ? "top" : "bottom",
        pcb_port_id: point.pcb_port_id,
        pointId: point.pcb_port_id,
      }),
    ),
  })
  fixture.srj.connections.push({
    name: "through-hole-attachment",
    rootConnectionName: "through",
    pointsToConnect: [
      {
        x: 0,
        y: 3,
        layer: "top",
        pcb_port_id: "pcb_port_through_hole",
        pointId: "pcb_port_through_hole",
      },
      {
        x: -2,
        y: 3,
        layer: "top",
        pcb_port_id: "pcb_port_through_start",
        pointId: "pcb_port_through_start",
      },
    ],
  })
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const referenceDrcEvaluator = createPipeline9RelaxedDrcEvaluator({
    useFinalOutputConversion: true,
    includeViaPadChecks: true,
    connections: fixture.srj.connections,
    originalConnections: fixture.srj.connections,
    layerCount: 2,
    obstacles: fixture.srj.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap,
    srjWithPointPairs: fixture.srj,
    originalSrj: fixture.srj,
    mutatedPreloadedTraces: [],
  })
  const before = referenceDrcEvaluator({ routes: fixture.hdRoutes, traces: [] })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  const solver = new Pipeline9Repair04Solver({
    srj: fixture.srj,
    hdRoutes: fixture.hdRoutes,
    connMap,
    referenceDrcEvaluator,
    enabled: true,
    allowLayerChanges: false,
    allowExistingViaRelocation: false,
    maxRegions: 1,
    maxCandidatesPerRegion: 2000,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(output.at(-1)).toEqual(atomicRoute)
  expect(getRepairViaGeometry(output.at(-1)!, 2)).toEqual([])
  const after = referenceDrcEvaluator({ routes: output, traces: [] })
  expect(Array.isArray(after) ? after : after.errors).toEqual([])
  expect(solver.stats.acceptedRegions).toBe(1)
  expect(fixture.hdRoutes).toEqual(originalRoutes)
})

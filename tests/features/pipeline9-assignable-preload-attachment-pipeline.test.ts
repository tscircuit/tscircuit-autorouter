import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { ConnectionPoint } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("Pipeline9 carries source-proven assignable attachment identity through MST and stitching without a pad claim", (): void => {
  const srj = createPipeline9AssignableAttachmentInput()
  srj.connections[0]!.pointsToConnect.pop()
  for (const point of srj.connections[0]!.pointsToConnect) {
    point.pointId = point.pcb_port_id
  }
  const snapshot = structuredClone(srj)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  const pipelineOriginalSnapshot = structuredClone(pipeline.originalSrj)
  pipeline.solveUntilPhase("topologyPlanningSolver")
  expect(pipeline.failed).toBe(false)
  expect(pipeline.netToPointPairsSolver?.solved).toBe(true)
  const pairedSrj = pipeline.srjWithPointPairs
  if (!pairedSrj || pairedSrj.connections.length !== 1) {
    throw new Error("Assignable fixture requires one unconnected MST pair")
  }
  const connection = pairedSrj.connections[0]!
  let attachment: ConnectionPoint | undefined
  for (const point of connection.pointsToConnect) {
    if (point.pcb_port_id === "port-a") attachment = point
  }
  expect(attachment).toEqual({
    x: 0.2,
    y: 0.2,
    layer: "top",
    pcb_port_id: "port-a",
    pointId: "port-a",
  })
  expect(connection.name).toBe("declared-net_mst0")
  expect(pipeline.originalSrj).toEqual(pipelineOriginalSnapshot)
  expect(pairedSrj.traces).toEqual(snapshot.traces)

  const route: HighDensityIntraNodeRoute = {
    connectionName: connection.name,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.2, y: 0.2, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routeSnapshot = structuredClone(route)
  const stitch = new MultipleHighDensityRouteStitchSolver3({
    connections: pairedSrj.connections,
    hdRoutes: [route],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  stitch.solve()
  expect(stitch.solved).toBe(true)
  expect(stitch.failed).toBe(false)
  expect(stitch.mergedHdRoutes).toHaveLength(1)
  const merged = stitch.mergedHdRoutes[0]!
  expect(merged.route).toEqual(routeSnapshot.route)
  expect(merged.startPcbPortId).toBe("port-a")
  expect(merged.endPcbPortId).toBe("port-c")
  expect(merged.vias).toEqual([])
  expect(route).toEqual(routeSnapshot)

  const prepared = createPipeline9FixedPadClearance({
    obstacles: pipeline.originalSrj.obstacles,
    connMap: getConnectivityMapFromSimpleRouteJson(pipeline.originalSrj),
    layerCount: 2,
    traceToPadClearance: 0.1,
    viaToPadClearance: 0.1,
  })
  expect(prepared.rectangles).toEqual([])
  expect(pipeline.originalSrj.obstacles).toEqual(
    pipelineOriginalSnapshot.obstacles,
  )
  expect(pipeline.originalSrj.traces).toEqual(snapshot.traces)
  expect(srj).toEqual(snapshot)
})

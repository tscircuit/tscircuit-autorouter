import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { ConnectionPoint } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createPipeline9PreloadAttachmentInput } from "./fixtures/createPipeline9PreloadAttachmentInput"

test("Pipeline9 carries physical preload attachment identity into point pairs and stitching", (): void => {
  const srj = createPipeline9PreloadAttachmentInput()
  srj.connections = [srj.connections[0]!]
  const originalSnapshot = structuredClone(srj)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  pipeline.solveUntilPhase("topologyPlanningSolver")
  expect(pipeline.failed).toBe(false)
  expect(pipeline.netToPointPairsSolver?.solved).toBe(true)
  const pairedSrj = pipeline.srjWithPointPairs
  if (!pairedSrj || pairedSrj.connections.length !== 1) {
    throw new Error("Attachment fixture requires one remaining routed pair")
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
    pointId: "logical-a",
  })
  expect(connection.name).toBe("new-pair-a-c")
  expect(pipeline.originalSrj.connections).toEqual(originalSnapshot.connections)
  expect(pipeline.originalSrj.traces).toEqual(originalSnapshot.traces)
  expect(pairedSrj.traces).toEqual(originalSnapshot.traces)

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
  expect(merged.route).toHaveLength(2)
  expect(merged.startPcbPortId).toBe("port-a")
  expect(merged.endPcbPortId).toBe("port-c")
  expect(merged.route[0]).toEqual({ x: 0.2, y: 0.2, z: 0 })
  for (const point of merged.route) {
    expect(point.x === 0 && point.y === 0).toBe(false)
  }
  expect(merged.vias).toEqual([])
  expect(route).toEqual(routeSnapshot)
  expect(srj).toEqual(originalSnapshot)
})

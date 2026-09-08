import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 derives finite cuts only from generated-copper input while retaining all declared anchors", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.125,
    minTraceToPadEdgeClearance: 0.0625,
    bounds: { minX: -2, maxX: 2, minY: -4, maxY: 4 },
    obstacles: [{
      obstacleId: "foreign-fixed-pad",
      type: "rect",
      center: { x: 0.5, y: 0 },
      width: 0.125,
      height: 1,
      layers: ["bottom"],
      connectedTo: ["unused-fixed-net"],
    }],
    connections: [{
      name: "route-a",
      pointsToConnect: [
        { x: -0.25, y: -3, layer: "top", pcb_port_id: "port-a" },
        { x: -0.25, y: 3, layer: "bottom", pcb_port_id: "port-b" },
      ],
    }],
  }
  const before = structuredClone(srj)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  pipeline.srjWithPointPairs = structuredClone(srj)
  pipeline.srjWithPointPairs.connections[0]!.pointsToConnect[0]!.x = -0.5
  const context = pipeline["createPhysicalNodeCutContext"]()
  expect(context).toBeDefined()
  expect(context?.traceWidth).toBe(0.125)
  expect(context?.traceGap).toBe(0.1)
  expect(context?.padGap).toBe(0.0625)
  expect(context?.layerCount).toBe(2)
  expect(context?.protectedPoints).toContainEqual({ x: -0.5, y: -3 })
  expect(context?.protectedPoints).toContainEqual({ x: -0.25, y: -3 })
  expect(context?.routableNetIds.size).toBe(1)
  expect(context?.rectangles).toHaveLength(1)
  expect(srj).toEqual(before)

  const withPreload = structuredClone(srj)
  withPreload.traces = [{
    type: "pcb_trace",
    pcb_trace_id: "unchanged-source-copper",
    connection_name: "route-a",
    connectsTo: ["port-a", "port-b"],
    route: [
      { route_type: "wire", x: -0.25, y: -3, width: 0.125, layer: "top" },
      { route_type: "wire", x: -0.25, y: 3, width: 0.125, layer: "top" },
    ],
  }]
  const preloadBefore = structuredClone(withPreload)
  const preloadedPipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    withPreload,
    { cacheProvider: null },
  )
  preloadedPipeline.srjWithPointPairs = structuredClone(withPreload)
  expect(preloadedPipeline["createPhysicalNodeCutContext"]()).toBeUndefined()
  expect(preloadedPipeline.originalSrj.traces).toEqual(preloadBefore.traces)
  expect(withPreload).toEqual(preloadBefore)

  pipeline.srjWithPointPairs.connections = []
  expect(pipeline["createPhysicalNodeCutContext"]()).toBeUndefined()
  pipeline.srjWithPointPairs = undefined
  expect((): void => {
    pipeline["createPhysicalNodeCutContext"]()
  }).toThrow("require the routing connections")
})

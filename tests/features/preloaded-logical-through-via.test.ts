import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { HighDensitySolverB01, defaultB01Params } from "@tscircuit/high-density-b01"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("preload occupies the physical barrel beyond a logical top-to-inner transition", async (): Promise<void> => {
  for (const allowBlindAndBuriedVias of [false, undefined, true]) {
    const input: SimpleRouteJson = {
      layerCount: 4,
      allowBlindAndBuriedVias,
      minTraceWidth: 0.1,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [],
      connections: [{ name: "existing", pointsToConnect: [{ x: -1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "inner1" }] }],
      traces: [{ type: "pcb_trace", pcb_trace_id: "existing-route", connection_name: "existing", route: [
        { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "inner1", via_diameter: 0.5, via_hole_diameter: 0.3 },
        { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.1 },
        { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.1 },
      ] }],
    }
    const boundary: SharedEdgeSegment = {
      edgeId: "crossing", nodeIds: ["left", "right"], start: { x: 0, y: -1 }, end: { x: 0, y: 1 }, availableZ: [0, 1, 2, 3],
      portPoints: [0, 1, 2, 3].map(z => ({ segmentPortPointId: `port-${z}`, x: 0, y: 0, availableZ: [z], nodeIds: ["left", "right"], edgeId: "crossing", connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
    }
    const preload = new PreloadedTraceGraphSolver([boundary], input)
    preload.solve()
    expect(preload.solved).toBeTrue()
    const fixedVia = convertPreloadedTraceToHdRoutes(input.traces![0]!, 0, 4, 0.5, new ConnectivityMap({})).find(route => route.vias.length > 0)!
    const b01 = new HighDensitySolverB01({
      ...defaultB01Params,
      nodeWithPortPoints: { capacityMeshNodeId: "bottom", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [3], portPoints: [{ x: -2, y: 0, z: 3, connectionName: "new-bottom" }, { x: 2, y: 0, z: 3, connectionName: "new-bottom" }] },
      obstacles: [{ type: "route", ...fixedVia, vias: [{ x: 0, y: 0, zStart: 0, zEnd: allowBlindAndBuriedVias ? 1 : 3 }] }],
      viaDiameter: 0.5, traceThickness: 0.1, obstacleClearanceMargin: 0.15, effort: 0.1,
    })
    b01.step()
    const before = structuredClone(b01.visualize())
    b01.solve()
    expect(b01.solved).toBeTrue()
    expect(b01.getOutput()).toHaveLength(1)
    expect(doPipeline9RoutesHaveCopperConflict({ layerCount: 4, allowBlindAndBuriedVias, left: b01.getOutput()[0]!, right: fixedVia, clearance: 0.15 })).toBeFalse()
    if (allowBlindAndBuriedVias === false) {
      await expect(getGraphicsSvgFrames({ frames: [
        { name: "Physical through barrel: before", step: "start", iteration: 0, graphics: before },
        { name: "Successful bottom route around barrel", step: "end", iteration: b01.iterations, graphics: b01.visualize() },
      ], columns: 2, backgroundColor: "white" })).toMatchSvgSnapshot(import.meta.path)
    }
    expect(boundary.portPoints.map(port => Boolean(port._preloadedTracePortAssignments?.length))).toEqual(allowBlindAndBuriedVias ? [true, true, false, false] : [true, true, true, true])
  }
})

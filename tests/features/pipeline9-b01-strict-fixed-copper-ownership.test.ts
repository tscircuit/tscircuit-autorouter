import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("B01 fixed copper exemptions require original same-owner proof despite rounded routing aliases", (): void => {
  for (const sameOriginalOwner of [false, true]) {
    const originalSrj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, obstacles: [],
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [
        { name: "signal", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "signal-port" }] },
        { name: "forest", pointsToConnect: [{ x: 0, y: 0.004, layer: "top",
          pcb_port_id: sameOriginalOwner ? "signal-port" : "forest-port" }] },
      ] }
    const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
    expect(connMap.getNetConnectedToId("signal")).toBe(connMap.getNetConnectedToId("forest"))
    const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj, routingConnMap: connMap })
    const ports = [{ x: -0.8, y: 0, z: 0, connectionName: "signal" }, { x: 0.8, y: 0, z: 0, connectionName: "signal" }]
    const node: NodeWithPortPoints = { capacityMeshNodeId: "b01-strict-owner", center: { x: 0, y: 0 },
      width: 2.2, height: 2.2, availableZ: [0], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
    const solver = new Pipeline9HighDensitySolver({ useNativeRegionalRouting: true, physicalOwnership, physicalBoardObstacles: originalSrj.obstacles,
      nodePortPoints: [node], fixedHdRoutes: [{ connectionName: "forest", rootConnectionName: connMap.getNetConnectedToId("forest"),
        traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -0.8, y: 0.004, z: 0 }, { x: 0.8, y: 0.004, z: 0 }],
        vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0 }], immutablePreloadedTraceIndices: [0],
      connMap, obstacles: [], layerCount: 2, viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
      obstacleMargin: 0.15, effort: 0.1, enableRegionalFallback: false, cacheProvider: null })
    solver.step()
    const b01 = solver.activeB01Solver!
    b01.solve()
    expect(b01.solved).toBeTrue()
    solver.step()
    expect(solver.routes).toHaveLength(sameOriginalOwner ? 1 : 0)
    expect(solver.failed).toBe(!sameOriginalOwner)
    if (!sameOriginalOwner) expect(solver.error).toContain("B01 output failed physical validation")
  }
})

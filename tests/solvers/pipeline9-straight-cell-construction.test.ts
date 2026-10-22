import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9StraightCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9StraightCell"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("Pipeline9 constructs clearance-proven chord families and dispatches unsupported geometry", () => {
  for (const scale of [0.5, 1, 3]) {
    for (const offset of [-5, 0, 13]) {
      const node: NodeWithPortPoints = {
        capacityMeshNodeId: `cell-${scale}-${offset}`,
        center: { x: offset, y: 0 },
        width: 4 * scale,
        height: 4 * scale,
        availableZ: [0, 1],
        portPoints: [-1, 0, 1].flatMap((y, index) => [
          {
            connectionName: `c${index}`,
            x: offset - 2 * scale,
            y: y * scale,
            z: index % 2,
            pcb_port_id: `start${index}`,
          },
          {
            connectionName: `c${index}`,
            x: offset + 2 * scale,
            y: (y + 0.1) * scale,
            z: index % 2,
            pcb_port_id: `end${index}`,
          },
        ]),
      }
      const params = {
        node,
        obstacles: [],
        layerCount: 2,
        traceWidth: 0.1,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
      }
      const construction = constructPipeline9StraightCell(params)
      expect(construction.applicable).toBe(true)
      if (!construction.applicable) throw new Error("Expected chord family")
      expect(construction.routes).toHaveLength(3)
      expect(construction.routes.every((route) => route.vias.length === 0)).toBe(true)
      expect(
        minimumDistanceBetweenSegments(
          construction.routes[0]!.route[0]!,
          construction.routes[0]!.route[1]!,
          construction.routes[2]!.route[0]!,
          construction.routes[2]!.route[1]!,
        ),
      ).toBeGreaterThan(0.25)

      const solver = new Pipeline9HighDensitySolver({
        ...params,
        nodePortPoints: [node],
        fixedHdRoutes: [],
        connMap: new ConnectivityMap({}),
        preserveTerminalPcbPortIds: true,
        effort: 1,
      })
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.stats.constructedStraightNodeCount).toBe(1)
      expect(solver.stats.regularNodeCount).toBe(0)
      expect(solver.routes[0]!.startPcbPortId).toBe("start0")
      expect(solver.routes[0]!.endPcbPortId).toBe("end0")

      const crossing = structuredClone(node)
      crossing.portPoints[1]!.y = scale
      crossing.portPoints[5]!.y = -scale
      expect(constructPipeline9StraightCell({ ...params, node: crossing }).applicable).toBe(false)
      const nearMiss = structuredClone(node)
      nearMiss.portPoints[4]!.y = -scale + 0.24
      nearMiss.portPoints[5]!.y = -scale + 0.24
      expect(constructPipeline9StraightCell({ ...params, node: nearMiss }).applicable).toBe(false)
      const transition = structuredClone(node)
      transition.portPoints[1]!.z = 1
      expect(constructPipeline9StraightCell({ ...params, node: transition }).applicable).toBe(false)
      expect(constructPipeline9StraightCell({
        ...params,
        obstacles: [{
          type: "rect",
          center: { x: offset, y: -scale },
          width: 0.2,
          height: 0.5,
          ccwRotationDegrees: 45,
          layers: ["top"],
          connectedTo: [],
        }],
      }).applicable).toBe(false)
      expect(constructPipeline9StraightCell({
        ...params,
        boardGeometry: {
          bounds: { minX: offset - 2 * scale, maxX: offset + 2 * scale, minY: -2 * scale, maxY: 2 * scale },
          minBoardEdgeClearance: 0.1,
        },
      }).applicable).toBe(false)
    }
  }
})

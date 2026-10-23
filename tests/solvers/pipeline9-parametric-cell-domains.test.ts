import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { doPipeline9RoutesHaveCopperConflict, getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("parametric domains construct metric elbow and via families with physical separation", () => {
  for (const scale of [0.75, 1, 4]) {
    for (const offset of [-12, 0, 19]) {
      const node: NodeWithPortPoints = {
        capacityMeshNodeId: "formula-domain",
        center: { x: offset, y: 0 }, width: 8 * scale, height: 8 * scale,
        availableZ: [0, 1, 2, 3],
        portPoints: [
          { connectionName: "elbow", x: offset - 3 * scale, y: -3 * scale, z: 0 },
          { connectionName: "elbow", x: offset + 3 * scale, y: 3 * scale, z: 0 },
          { connectionName: "transition", x: offset - 3 * scale, y: 2 * scale, z: 1 },
          { connectionName: "transition", x: offset + 3 * scale, y: 2 * scale, z: 3 },
        ],
      }
      const params = {
        node, connMap: new ConnectivityMap({}), layerCount: 4,
        traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15,
        obstacles: [{ type: "rect" as const, center: { x: offset, y: 0 }, width: scale, height: scale, ccwRotationDegrees: 30, layers: ["top"], connectedTo: [] }],
      }
      const result = constructPipeline9ParametricCell(params)
      expect(result.applicable).toBe(true)
      expect(result.routes).toHaveLength(2)
      expect(result.stats.parametricElbowRouteCount).toBe(2)
      expect(result.stats.parametricCompiledViaCount).toBe(1)
      expect(result.stats.parametricAssignmentChecks).toBeGreaterThan(0)
      expect(doPipeline9RoutesHaveCopperConflict({ left: result.routes[0]!, right: result.routes[1]!, layerCount: 4, clearance: 0.15 })).toBe(false)
      const via = getPipeline9RouteCopperGeometry(result.routes[1]!, { layerCount: 4 }).viaSpans[0]!
      expect(via.minZ).toBe(0)
      expect(via.maxZ).toBe(3)
      for (const route of result.routes) {
        for (let i = 1; i < route.route.length; i++) {
          const a = route.route[i - 1]!
          const b = route.route[i]!
          const dx = Math.abs(a.x - b.x)
          const dy = Math.abs(a.y - b.y)
          expect(dx < 1e-9 || dy < 1e-9 || Math.abs(dx - dy) < 1e-9).toBe(true)
          if (a.z !== b.z) expect(dx + dy).toBe(0)
        }
      }
      const blocked = constructPipeline9ParametricCell({ ...params, obstacles: [...params.obstacles, { type: "rect" as const, center: { x: offset, y: 0 }, width: 9 * scale, height: 9 * scale, layers: ["top", "inner1", "inner2", "bottom"], connectedTo: [] }] })
      expect(blocked.applicable).toBe(false)
      expect(blocked.routes).toHaveLength(0)
      const invalid = structuredClone(node)
      invalid.portPoints[0]!.x = Number.NaN
      expect(() => constructPipeline9ParametricCell({ ...params, node: invalid })).toThrow("invalid geometry")
    }
  }
})

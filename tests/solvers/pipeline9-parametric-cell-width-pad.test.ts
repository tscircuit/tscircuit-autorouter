import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("physical formula domains use nominal net widths and forbid drilling through an owned SMT pad", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "rules", center: { x: 0, y: 0 }, width: 8, height: 8, portPoints: [{ connectionName: "wide", x: -3, y: 0, z: 0 }, { connectionName: "wide", x: 3, y: 0, z: 0 }] }
  const params = { node, connMap: new ConnectivityMap({ wide: ["wide", "pad"] }), layerCount: 2, traceWidth: 0.1, traceWidthByConnection: { wide: 0.8 }, viaDiameter: 0.3, obstacleMargin: 0.15, obstacles: [] }
  const result = constructPipeline9ParametricCell(params)
  expect(result.applicable).toBe(true)
  expect(result.routes[0]!.traceThickness).toBe(0.8)
  const transition = { ...node, portPoints: [node.portPoints[0]!, { ...node.portPoints[1]!, z: 1 }] }
  const blocked = constructPipeline9ParametricCell({ ...params, node: transition, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 7, height: 7, layers: ["top"], connectedTo: ["pad"] }] })
  expect(blocked.applicable).toBe(false)
  expect(blocked.routes).toHaveLength(0)
  expect(() => constructPipeline9ParametricCell({ ...params, traceWidthByConnection: { wide: Number.NaN } })).toThrow("invalid physical rules")
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("explicit formula pairs require exact original interface witnesses and all physical layers remain validated", (): void => {
  const ports = [{ connectionName: "signal", portPointId: "a", x: -1, y: 0, z: 0 }, { connectionName: "signal", portPointId: "b", x: 1, y: 0, z: 0 }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "interface", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: ports, portPointsInPairs: [[{ ...ports[0]! }, { ...ports[1]! }]] }
  const params = { node, connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15 }
  expect(constructPipeline9ParametricCell(params).applicable).toBe(true)
  for (const change of [{ x: Number.NaN }, { z: 2 }, { x: -0.5 }, { connectionName: "foreign" }, { portPointId: "unknown" }, { pcb_port_id: "foreign-pad" }]) {
    const invalid = structuredClone(node)
    Object.assign(invalid.portPointsInPairs![0]![0], change)
    expect(() => constructPipeline9ParametricCell({ ...params, node: invalid })).toThrow("endpoint")
  }
  for (const z of [Number.NaN, -1, 2, 0.5]) {
    expect(() => constructPipeline9ParametricCell({ ...params, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], __zLayers: [z], connectedTo: [] }] })).toThrow("invalid copper layers")
  }
})

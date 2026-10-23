import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9ParametricCell } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("parametric physical domains honor a trace-pad rule larger than the planning margin", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "trace-pad-gap", center: { x: 0, y: 0 }, width: 4, height: 2, availableZ: [0],
    portPoints: [{ connectionName: "signal", x: -1, y: 0, z: 0 }, { connectionName: "signal", x: 1, y: 0, z: 0 }] }
  const rules = { layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1, traceToPadClearance: 0.5,
    obstacles: [{ type: "rect" as const, center: { x: 0, y: 0.45 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign-pad"] }] }
  const strict = constructPipeline9ParametricCell({ ...rules, node, connMap: new ConnectivityMap({}) })
  expect(strict.applicable).toBe(false)
  expect(strict.routes).toHaveLength(0)
  const permissive = { ...rules, traceToPadClearance: 0.1 }
  const legal = constructPipeline9ParametricCell({ ...permissive, node, connMap: new ConnectivityMap({}) })
  expect(legal.applicable).toBe(true)
  expect(legal.routes[0]!.route).toEqual([{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])
  for (const gap of [Number.NaN, Infinity, -0.1]) {
    expect(() => constructPipeline9ParametricCell({ ...rules, node, connMap: new ConnectivityMap({}), traceToPadClearance: gap })).toThrow("invalid physical rules")
  }
})

import { expect, test } from "bun:test"
import { Pipeline9StraightCellCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9StraightCell"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("straight witness checks the full cell against foreign obstacles, board, future contacts and layer transitions", (): void => {
  const node = createOrderedPortalFixture()[0]!
  for (const pair of node.portPointsInPairs!) for (const point of pair) point.y = point.connectionName.endsWith("0") ? -0.4 : 0.4
  const base = { obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15 }
  const obstacle = { type: "rect" as const, center: { x: 0.5, y: -0.4 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] as string[] }
  expect(new Pipeline9StraightCellCertifier({ ...base, obstacles: [obstacle] }).certify(node, new Map())).toEqual({ certified: false, reason: "obstacle" })
  expect(new Pipeline9StraightCellCertifier({ ...base, obstacles: [{ ...obstacle, connectedTo: ["root-0"] }] }).certify(node, new Map()).certified).toBe(true)
  expect(new Pipeline9StraightCellCertifier({ ...base, physicalTerminals: [{ x: 0.5, y: -0.4, z: 0, connectionName: "future-foreign-net" }] }).certify(node, new Map())).toEqual({ certified: false, reason: "terminal" })
  expect(new Pipeline9StraightCellCertifier({ ...base, physicalTerminals: [{ x: 0.5, y: -0.4, z: 0, connectionName: "root-0" }] }).certify(node, new Map()).certified).toBe(true)
  expect(new Pipeline9StraightCellCertifier({ ...base, boardGeometry: { bounds: { minX: -0.2, maxX: 1.2, minY: -0.42, maxY: 1 } } }).certify(node, new Map())).toEqual({ certified: false, reason: "board" })
  node.portPointsInPairs![0]![1].z = 1
  expect(new Pipeline9StraightCellCertifier(base).certify(node, new Map())).toEqual({ certified: false, reason: "layer" })
})

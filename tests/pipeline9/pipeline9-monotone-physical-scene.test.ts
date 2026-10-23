import { expect, test } from "bun:test"
import { constructPipeline9MonotoneFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9MonotoneFamily"
import type { Obstacle } from "../../lib/types/srj-types"

test("instantiated-copper certificate permits off-path cell obstacles and enforces rotated pads, outline and via layer spans", () => {
  const node = { capacityMeshNodeId: "cell", center: { x: 0, y: 0 }, width: 20, height: 6, portPoints: [-0.4, 0, 0.4].flatMap((y, i) => [{ x: -10.00005, y, z: 1, connectionName: `n${i}` }, { x: 10.00005, y, z: 2, connectionName: `n${i}` }]) }
  const base = { node, traceWidth: 0.15, clearance: 0.15, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 0.1, obstacles: [] as Obstacle[], layerCount: 4, scenePorts: node.portPoints, sceneRoutes: [], cache: new Map() }
  const clear = constructPipeline9MonotoneFamily({ ...base, obstacles: [{ type: "rect", shape: "circle", layers: ["top"], center: { x: 0, y: 2 }, width: 0.2, height: 0.2, connectedTo: [] }] })
  expect(clear.applicable).toBe(true)
  expect(clear.stats.monotoneFamilyObstaclePredicates).toBeGreaterThan(0)
  const blocked = constructPipeline9MonotoneFamily({ ...base, obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 0.2, height: 0.8, ccwRotationDegrees: 45, connectedTo: [] }] })
  expect(blocked.applicable).toBe(false)
  expect(blocked.stats.monotoneFamilyPhysicalDomainRejectedCells).toBe(1)
  const foreign = { x: 0, y: 0, z: 0, connectionName: "foreign" }
  expect(constructPipeline9MonotoneFamily({ ...base, scenePorts: [...node.portPoints, foreign] }).applicable).toBe(false)
  expect(constructPipeline9MonotoneFamily({ ...base, allowBlindAndBuriedVias: true, scenePorts: [...node.portPoints, foreign] }).applicable).toBe(true)
  const outside = constructPipeline9MonotoneFamily({ ...base, boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } } })
  expect(outside.applicable).toBe(false)
})

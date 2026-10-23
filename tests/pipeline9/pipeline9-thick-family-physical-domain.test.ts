import { expect, test } from "bun:test"
import { constructPipeline9ThickFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ThickFamily"

test("collective constructor rejects foreign terminal, previous copper, rotated pad, outline, crossings, and vias explicitly", () => {
  const node = { capacityMeshNodeId: "test", center: { x: 0, y: 0 }, width: 10, height: 6,
    portPoints: [-2, 2].flatMap((y, i) => [{ x: -5, y, z: 0, connectionName: `n${i}` }, { x: 5, y, z: 0, connectionName: `n${i}` }]) }
  const base = { node, traceWidth: 0.2, clearance: 0.15, viaDiameter: 0.6, obstacles: [], layerCount: 2, scenePorts: [], sceneRoutes: [] }
  expect(constructPipeline9ThickFamily(base).applicable).toBe(true)
  const terminal = constructPipeline9ThickFamily({ ...base, scenePorts: [{ x: 0, y: -2, z: 0, connectionName: "foreign" }] })
  expect(terminal.applicable).toBe(false)
  expect(terminal.stats.thickFamilyClearanceRejectedCells).toBe(1)
  const copper = constructPipeline9ThickFamily({ ...base, sceneRoutes: [{ connectionName: "foreign", traceThickness: 0.2, viaDiameter: 0.6, vias: [], route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }] }] })
  expect(copper.applicable).toBe(false)
  expect(copper.stats.thickFamilySceneRoutePredicates).toBeGreaterThan(0)
  const obstacle = constructPipeline9ThickFamily({ ...base, obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: -2 }, width: 0.2, height: 1, ccwRotationDegrees: 45, connectedTo: [] }] })
  expect(obstacle.applicable).toBe(false)
  expect(obstacle.stats.thickFamilyPhysicalDomainRejectedCells).toBe(1)
  const outline = constructPipeline9ThickFamily({ ...base, boardGeometry: { bounds: { minX: -6, maxX: 6, minY: -4, maxY: 4 }, outline: [{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: 0, y: -2.5 }, { x: -6, y: 4 }] } })
  expect(outline.applicable).toBe(false)
  const crossed = constructPipeline9ThickFamily({ ...base, node: { ...node, portPoints: node.portPoints.map((p, i) => i === 1 || i === 3 ? { ...p, y: -p.y } : p) } })
  expect(crossed.applicable).toBe(false)
  expect(crossed.stats.thickFamilyUnsupportedPairingCells).toBe(1)
  const via = constructPipeline9ThickFamily({ ...base, node: { ...node, portPoints: node.portPoints.map((p, i) => ({ ...p, z: i === 1 ? 1 : 0 })) } })
  expect(via.applicable).toBe(false)
  expect(via.stats.thickFamilyUnsupportedLayerCells).toBe(1)
})

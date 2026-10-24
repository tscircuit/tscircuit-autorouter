import { expect, test } from "bun:test"
import { PersistentRepairScene } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/PersistentRepairScene"
import { createRepairSceneDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/RepairGeometryDistanceCache"

type Copper = Parameters<PersistentRepairScene["setCopper"]>[0]
function pointCopper(x: number): Copper {
  return { a: { x, y: 0, z: 0 }, b: { x, y: 0, z: 3 }, minX: x, maxX: x, minY: 0, maxY: 0, minZ: 0, maxZ: 3, radius: 0.001, spanIndex: 0, index: 0, cellX: Math.floor(x), cellY: 0 }
}

test("a cached empty actual query retains its whole envelope, invalidates moved-in geometry, and supports safe huge-coordinate revisions", (): void => {
  const diagnostics = createRepairSceneDiagnostics()
  const scene = new PersistentRepairScene(1, diagnostics, true)
  scene.setCopper(pointCopper(5))
  scene.beginSearch()
  const left = { x: 0.05, y: 0.01, z: 0 }, right = { x: 0.2, y: 0.01, z: 0 }
  expect(scene.query(left, left, 0.01)).toHaveLength(0)
  scene.setCopper(pointCopper(0.2))
  scene.beginSearch()
  expect(scene.query(left, left, 0.01)).toHaveLength(0)
  const queries = diagnostics.nativeBroadphaseQueries
  expect(scene.query(right, right, 0.01)).toHaveLength(1)
  expect(diagnostics.nativeBroadphaseQueries).toBe(queries)
  expect(diagnostics.candidateInvalidations).toBeGreaterThan(0)
  scene.setCopper(pointCopper(2 ** 53))
  scene.beginSearch()
  const large = { x: 2 ** 53, y: 0, z: 0 }
  expect(scene.query(large, large, 0.01)).toHaveLength(1)
  expect(scene.query(right, right, 0.01)).toHaveLength(0)
  expect(diagnostics.candidateCacheResets).toBeGreaterThan(0)
})

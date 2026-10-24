import { expect, test } from "bun:test"
import { PersistentRepairScene } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/PersistentRepairScene"
import { createRepairSceneDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/RepairGeometryDistanceCache"
import { REGION_EPSILON } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/pipeline9RepairGeometry"

type Copper = Parameters<PersistentRepairScene["setCopper"]>[0]
function copper(spanIndex: number, x: number, y: number, radius = 0.1, minZ = 0, maxZ = 3): Copper {
  return {
    spanIndex, index: 0, a: { x, y, z: minZ }, b: { x: x + 0.2, y, z: maxZ },
    radius, minZ, maxZ, minX: x, maxX: x + 0.2, minY: y, maxY: y,
    cellX: Math.floor(x - radius), cellY: Math.floor(y - radius),
  }
}

test("persistent physical queries invalidate old and new footprints and remain exact through bounded resets, removal, radius/layer and boundary changes", (): void => {
  const diagnostics = createRepairSceneDiagnostics()
  const scene = new PersistentRepairScene(4, diagnostics, true, 8, 3, 8)
  const current = new Map<number, Copper>()
  const put = (item: Copper): void => { current.set(item.spanIndex, item); scene.setCopper(item) }
  put(copper(0, 0, 0))
  put(copper(1, 9, 9))
  scene.beginSearch()
  const a = { x: -0.01, y: -0.01, z: 0 }, b = { x: 0.01, y: 0.01, z: 0 }
  scene.query(a, b, 0.1)
  scene.beginSearch()
  expect(scene.query(a, b, 0.1).map((item) => item.spanIndex)).toEqual([0])
  expect(diagnostics.crossSearchCandidateHits).toBe(1)
  for (let step = 0; step < 80; step++) {
    if (step % 7 === 0) {
      const index = step % 4
      current.delete(index); scene.removeCopper(index, 0)
    } else {
      const index = step % 4
      put(copper(index, ((step * 17) % 19 - 9) / 4, ((step * 13) % 17 - 8) / 4, step % 11 === 0 ? 40 : (step % 5 + 1) / 20, step % 2, step % 3 + 1))
    }
    scene.beginSearch()
    for (let query = 0; query < 12; query++) {
      const p = { x: (query - 6) / 3, y: (query % 5 - 2) / 3, z: query % 4 }
      const q = { x: p.x + 0.07, y: p.y + 0.03, z: query % 2 ? p.z : 3 }
      const reach = query % 3 / 10
      const expected = [...current.values()].filter((item) => item.minX - item.radius - REGION_EPSILON <= Math.max(p.x, q.x) + reach + REGION_EPSILON && item.maxX + item.radius + REGION_EPSILON >= Math.min(p.x, q.x) - reach - REGION_EPSILON && item.minY - item.radius - REGION_EPSILON <= Math.max(p.y, q.y) + reach + REGION_EPSILON && item.maxY + item.radius + REGION_EPSILON >= Math.min(p.y, q.y) - reach - REGION_EPSILON).sort((x, y) => x.spanIndex - y.spanIndex)
      const actual = [...scene.query(p, q, reach)].sort((x, y) => x.spanIndex - y.spanIndex)
      expect(actual.map((item) => [item.spanIndex, item.radius, item.minZ, item.maxZ])).toEqual(expected.map((item) => [item.spanIndex, item.radius, item.minZ, item.maxZ]))
      expect(scene.retainedCandidateReferences).toBeLessThanOrEqual(3)
      expect(scene.revisionCellCount).toBeLessThanOrEqual(8)
    }
  }
  put(copper(0, 1 + REGION_EPSILON, 0, REGION_EPSILON))
  scene.beginSearch()
  const p = { x: 1 - REGION_EPSILON, y: 0, z: 0 }
  expect(scene.query(p, p, REGION_EPSILON).some((item) => item.spanIndex === 0)).toBeTrue()
  expect(diagnostics.physicalSegmentsChanged).toBeGreaterThan(0)
  expect(diagnostics.physicalSegmentsRemoved).toBeGreaterThan(0)
  expect(diagnostics.candidateCacheResets).toBeGreaterThan(0)
})

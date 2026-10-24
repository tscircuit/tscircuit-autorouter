import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { RepairGeometryDistanceCache, createRepairSceneDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/RepairGeometryDistanceCache"

test("repair raw distances survive only exact geometry, including in-place moves, removals, directed keys and bounded eviction", (): void => {
  const diagnostics = createRepairSceneDiagnostics()
  const cache = new RepairGeometryDistanceCache(2, diagnostics, 1, true)
  const a = { x: -0, y: -2 }, b = { x: 0, y: 2 }
  const u = { x: -1, y: 0 }, v = { x: 1, y: 0 }
  const segment = cache.getSegment(0, 0, u, v)
  expect(diagnostics.distanceTableAllocatedBytes).toBe(0)
  cache.beginSearch()
  expect(Object.is(cache.distance(segment, a, b, u, v), segmentToSegmentMinDistance(a, b, u, v))).toBeTrue()
  cache.beginSearch()
  expect(cache.distance(segment, a, b, u, v)).toBe(0)
  expect(diagnostics.crossSearchDistanceHits).toBe(1)
  for (const [point, axis, value] of [[u, "x", 7], [u, "y", 4], [v, "x", 9], [v, "y", 4]] as const) {
    point[axis] = value
    const previous = diagnostics.nativeDistanceEvaluations
    expect(Object.is(cache.distance(segment, a, b, u, v), segmentToSegmentMinDistance(a, b, u, v))).toBeTrue()
    expect(diagnostics.nativeDistanceEvaluations).toBe(previous + 1)
  }
  const changed = diagnostics.physicalSegmentsChanged
  expect(cache.getSegment(0, 0, u, v)).toBe(segment)
  expect(diagnostics.physicalSegmentsChanged).toBe(changed)
  const beforeReverse = diagnostics.nativeDistanceEvaluations
  cache.distance(segment, b, a, u, v)
  expect(diagnostics.nativeDistanceEvaluations).toBe(beforeReverse + 1)
  a.x = 0
  cache.distance(segment, a, b, u, v)
  expect(diagnostics.nativeDistanceEvaluations).toBe(beforeReverse + 2)
  cache.beginSpan(0, 0)
  const replacement = cache.getSegment(0, 0, u, v)
  expect(replacement.id).not.toBe(segment.id)
  cache.distance(replacement, a, b, u, v)
  expect(diagnostics.physicalSegmentsRemoved).toBe(1)
  expect(diagnostics.distanceEvictions).toBeGreaterThan(0)
  expect(diagnostics.distanceTableAllocatedBytes).toBe(56)
  expect(diagnostics.distanceLookups).toBe(diagnostics.distanceHits + diagnostics.nativeDistanceEvaluations)
  const quietDiagnostics = createRepairSceneDiagnostics()
  const quiet = new RepairGeometryDistanceCache(1, quietDiagnostics, 1)
  const quietSegment = quiet.getSegment(0, 0, u, v)
  quiet.beginSearch()
  expect(quiet.distance(quietSegment, a, b, u, v)).toBe(segmentToSegmentMinDistance(a, b, u, v))
  quiet.beginSearch()
  expect(quiet.distance(quietSegment, a, b, u, v)).toBe(segmentToSegmentMinDistance(a, b, u, v))
  expect(quietDiagnostics.distanceHits).toBe(0)
  expect(quietDiagnostics.distanceLookups).toBe(0)
  expect(quietDiagnostics.workInstrumentedCaches).toBe(0)
  expect(quietDiagnostics.distanceTableAllocatedBytes).toBe(48)
})

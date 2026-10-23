import { test, expect } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { nativeOffsetOutline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/createNativeObstacleEventSearch"
test("native capsule offset has certified outward chords at every segment", () => {
  const stats = { experimentalEventHullTests: 0, experimentalEventOutlineVertices: 0, experimentalEventMaximumOffsetError: 0 }
  const barrier = { a: {x:-1,y:0,z:0}, b:{x:1,y:0,z:0}, radius:0.3, minZ:0,maxZ:0,rectCos:1,rectSin:0 }
  const points=nativeOffsetOutline(barrier,0.2,0.001,stats)
  for(let i=0;i<points.length;i++) expect(segmentToSegmentMinDistance(points[i]!,points[(i+1)%points.length]!,barrier.a,barrier.b)).toBeGreaterThanOrEqual(0.5-1e-8)
  expect(stats.experimentalEventMaximumOffsetError).toBeLessThanOrEqual(0.00100001)
  expect(points.length).toBeGreaterThan(8)
})

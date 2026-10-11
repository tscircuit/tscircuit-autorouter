import { expect, test } from "bun:test"
import { Pipeline9IndexedRelaxTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { getLocalObstacleDistance, type ObstacleDistanceGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/obstacleDistanceGeometry"
import { projectionInput } from "../fixtures/repair04StepFixtures"

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type SegmentDiagnostic = { a: Point; b: Point; initialBounds: Bounds; boundsCache?: Bounds }
type PadDiagnostic = {
  center: Point
  cosine: number
  sine: number
  shape: ObstacleDistanceGeometry
  clearance: number
  distanceCache?: { distance: number }
}
type SolverDiagnostic = {
  getSegmentBounds(segment: SegmentDiagnostic): Bounds
  getViaPadDistance(point: Point, pad: PadDiagnostic): number
}

function assertDistance(
  diagnostic: SolverDiagnostic,
  point: Point,
  pad: PadDiagnostic,
): void {
  const dx = point.x - pad.center.x, dy = point.y - pad.center.y
  const local = {
    x: dx * pad.cosine + dy * pad.sine,
    y: -dx * pad.sine + dy * pad.cosine,
  }
  const expected = getLocalObstacleDistance(local, local, pad.shape)
  expect(Object.is(diagnostic.getViaPadDistance(point, pad), expected)).toBeTrue()
  const cache = pad.distanceCache
  expect(Object.is(diagnostic.getViaPadDistance(point, pad), expected)).toBeTrue()
  expect(pad.distanceCache).toBe(cache)
}

test("projection geometry caches preserve exact kernels across every geometry mutation", (): void => {
  const solver = new Pipeline9IndexedRelaxTraceClearanceSolver(projectionInput)
  const diagnostic = solver as unknown as SolverDiagnostic
  const segment: SegmentDiagnostic = {
    a: { x: -0, y: 0 }, b: { x: 0, y: -0 },
    initialBounds: { minX: -0, maxX: 0, minY: -0, maxY: 0 },
  }
  const originalBounds = structuredClone(segment.initialBounds)
  let randomState = 0x8936ea25
  const random = (): number => {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    return (randomState >>> 0) / 0x100000000
  }
  const special = [-0, 0, NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE]
  for (let index = 0; index < 1024; index++) {
    const point = index % 2 === 0 ? segment.a : segment.b
    const value = index < special.length * 2 ? special[Math.floor(index / 2)]! : random() * 20 - 10
    if (index % 4 < 2) point.x = value
    else point.y = value
    const expected = {
      minX: Math.min(segment.a.x, segment.b.x), maxX: Math.max(segment.a.x, segment.b.x),
      minY: Math.min(segment.a.y, segment.b.y), maxY: Math.max(segment.a.y, segment.b.y),
    }
    const bounds = diagnostic.getSegmentBounds(segment)
    for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
      expect(Object.is(bounds[key], expected[key])).toBeTrue()
    }
    expect(diagnostic.getSegmentBounds(segment)).toBe(bounds)
    expect(segment.initialBounds).toEqual(originalBounds)
  }
  const point = { x: 0.71, y: -0.23 }
  const pad: PadDiagnostic = {
    center: { x: 0.05, y: -0.12 }, cosine: Math.cos(0.27), sine: Math.sin(0.27),
    clearance: 0.1,
    shape: { type: "rect", bounds: { minX: -0.3, maxX: 0.3, minY: -0.1, maxY: 0.1 } },
  }
  for (let index = 0; index < 1024; index++) {
    assertDistance(diagnostic, point, pad)
    switch (index % 12) {
      case 0: point.x = random() * 2 - 1; break
      case 1: point.y = random() * 2 - 1; break
      case 2: pad.center.x = random() - 0.5; break
      case 3: pad.center.y = random() - 0.5; break
      case 4: pad.cosine = Math.cos(random()); break
      case 5: pad.sine = Math.sin(random()); break
      case 6: pad.clearance = random(); break
      case 7:
        pad.shape = { type: "oval", a: { x: -0.3, y: 0 }, b: { x: 0.3, y: 0 }, radius: 0.1 }
        break
      case 8:
        pad.shape = { type: "rect", bounds: { minX: -0.3, maxX: 0.3, minY: -0.1, maxY: 0.1 } }
        break
      default:
        if (pad.shape.type === "rect") {
          for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
            pad.shape.bounds[key] = random() * 2 - 1
            assertDistance(diagnostic, point, pad)
          }
        } else {
          for (const endpoint of [pad.shape.a, pad.shape.b]) {
            endpoint.x = random() - 0.5
            assertDistance(diagnostic, point, pad)
            endpoint.y = random() - 0.5
            assertDistance(diagnostic, point, pad)
          }
          pad.shape.radius = random()
        }
    }
    assertDistance(diagnostic, point, pad)
  }
  for (const value of special) {
    for (const shape of [
      { type: "rect", bounds: { minX: -0, maxX: 0, minY: -1, maxY: 1 } },
      { type: "oval", a: { x: -0, y: 0 }, b: { x: 0, y: -0 }, radius: 0.1 },
    ] satisfies ObstacleDistanceGeometry[]) {
      pad.shape = shape
      pad.center = { x: 0, y: 0 }
      pad.cosine = 1
      pad.sine = 0
      point.x = value
      point.y = value
      assertDistance(diagnostic, point, pad)
    }
  }
})

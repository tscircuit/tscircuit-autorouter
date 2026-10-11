import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { prepareSegmentDistanceGeometry, segmentToSegmentMinDistanceWithGeometry, updateSegmentDistanceGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/segmentToSegmentMinDistanceWithGeometry"

type Point = { x: number; y: number }
type Segments = [Point, Point, Point, Point]

test("prepared segment distance preserves exact math-utils results for degenerate and floating point geometry", (): void => {
  let state = 0x369feaa7
  const random = (): number => {
    state = Math.imul(state ^ state >>> 15, 0x2c1b3c6d)
    state = Math.imul(state ^ state >>> 12, 0x297a2d39)
    state ^= state >>> 15
    return (state >>> 0) / 0x1_0000_0000
  }
  const point = (scale: number): Point => {
    const x = (random() - 0.5) * scale
    const y = (random() - 0.5) * scale
    return {
      x,
      y,
    }
  }
  const fixed: Segments[] = [
    [{ x: -0, y: 0 }, { x: 0, y: -0 }, { x: 1, y: 2 }, { x: 3, y: 4 }],
    [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: -0, y: 0 }, { x: 0, y: -0 }],
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 0 }, { x: 6, y: 0 }],
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 1e-20 }, { x: 6, y: 1e-20 }],
    [{ x: 0, y: 0 }, { x: 1e308, y: 1e308 }, { x: -1e308, y: 1e308 }, { x: 1e308, y: -1e308 }],
  ]
  const scratch = prepareSegmentDistanceGeometry(fixed[0]![0], fixed[0]![1])
  for (let index = 0; index < 100_000; index++) {
    const scale = 10 ** ((index % 31) - 15)
    const points: Segments = index < fixed.length ? fixed[index]! : [point(scale), point(scale), point(scale), point(scale)]
    if (index % 7 === 0) points[1] = { ...points[0] }
    if (index % 11 === 0) points[3] = { ...points[2] }
    if (index % 13 === 0) points[2] = { ...points[1] }
    if (index % 17 === 0) points[1] = { x: points[1].x, y: points[0].y }
    if (index % 19 === 0) points[3] = { x: points[3].x, y: points[2].y }
    const [a, b, c, d] = points
    updateSegmentDistanceGeometry(scratch, a, b)
    const copper = prepareSegmentDistanceGeometry(c, d)
    const expected = segmentToSegmentMinDistance(a, b, c, d)
    expect(segmentToSegmentMinDistanceWithGeometry(scratch, copper)).toBe(expected)
    updateSegmentDistanceGeometry(scratch, b, a)
    expect(segmentToSegmentMinDistanceWithGeometry(scratch, copper)).toBe(segmentToSegmentMinDistance(b, a, c, d))
  }
})

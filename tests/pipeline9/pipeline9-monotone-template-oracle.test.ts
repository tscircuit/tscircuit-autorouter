import { expect, test } from "bun:test"
import { compileMonotoneLaneTemplate, type MonotoneLaneTemplateCache } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/compileMonotoneLaneTemplate"
import { monotoneFamilyStatKeys } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9MonotoneFamily"

test("compiled active-set domains reproduce exact ordered-difference projection across affine reuse and regime changes", () => {
  const cache: MonotoneLaneTemplateCache = new Map()
  const stats = Object.fromEntries(monotoneFamilyStatKeys.map((key) => [key, 0])) as Record<string, number>
  for (let sample = 0; sample < 40; sample++) {
    const targets = [Math.sin(sample * 0.7) * 2, Math.cos(sample * 0.4), Math.sin(sample * 0.3) * 1.5]
    const separation = 0.3, lower = -1, upper = 0.4
    const lanes = compileMonotoneLaneTemplate({ key: "three-lanes", targets, separation, lower, upper, cache, stats })
    let optimum = Infinity
    // Independent exhaustive active-partition oracle, no PAV or KKT reuse.
    for (let mask = 0; mask < 4; mask++) {
      const blocks: number[][] = [[]]
      for (let index = 0; index < 3; index++) {
        blocks.at(-1)!.push(index)
        if (index < 2 && (mask & (1 << index))) blocks.push([])
      }
      const projected = new Array<number>(3)
      for (const block of blocks) {
        const mean = block.reduce((sum, i) => sum + targets[i]! - i * separation, 0) / block.length
        const bounded = Math.max(lower, Math.min(upper, mean))
        for (const i of block) projected[i] = bounded + i * separation
      }
      if (projected.some((value, i) => i > 0 && value - projected[i - 1]! < separation - 1e-9)) continue
      const objective = projected.reduce((sum, value, i) => sum + (value - targets[i]!) ** 2, 0)
      optimum = Math.min(optimum, objective)
    }
    expect(lanes.reduce((sum, value, i) => sum + (value - targets[i]!) ** 2, 0)).toBeCloseTo(optimum, 10)
    expect(lanes[0]!).toBeGreaterThanOrEqual(lower - 1e-8)
    expect(lanes[2]!).toBeLessThanOrEqual(upper + 2 * separation + 1e-8)
    expect(lanes[1]! - lanes[0]!).toBeGreaterThanOrEqual(separation - 1e-8)
    expect(lanes[2]! - lanes[1]!).toBeGreaterThanOrEqual(separation - 1e-8)
  }
  expect(stats.monotoneFamilyTemplateCacheHits).toBeGreaterThan(0)
  expect(stats.monotoneFamilyTemplateDomainRejections).toBeGreaterThan(0)
  expect(stats.monotoneFamilyContinuousSolves).toBeGreaterThan(1)
})

type ActiveBlock = { first: number; last: number; mode: "free" | "lower" | "upper" }
type LaneTemplate = { blocks: ActiveBlock[] }
export type MonotoneLaneTemplateCache = Map<string, LaneTemplate[]>
type Params = { key: string; targets: number[]; separation: number; lower: number; upper: number; cache: MonotoneLaneTemplateCache; stats: Record<string, number> }
const EPS = 1e-8

/** Each free block is an affine formula: mean(target[j]-j*d)+i*d.
 * A bound-active block instead uses lower+i*d or upper+i*d. */
function instantiateTemplate(template: LaneTemplate, params: Params): number[] | null {
  const transformed = params.targets.map((target, index) => target - index * params.separation)
  const lanes = new Array<number>(transformed.length)
  let previousMean = -Infinity
  for (const block of template.blocks) {
    let sum = 0
    for (let index = block.first; index <= block.last; index++) sum += transformed[index]!
    const mean = sum / (block.last - block.first + 1)
    params.stats.monotoneFamilyTemplateDomainPredicates++
    if (mean < previousMean - EPS) return null
    previousMean = mean
    // Prefix residual inequalities certify this exact unbounded isotonic block.
    let prefix = 0
    for (let index = block.first; index < block.last; index++) {
      prefix += transformed[index]! - mean
      params.stats.monotoneFamilyTemplateDomainPredicates++
      if (prefix < -EPS) return null
    }
    params.stats.monotoneFamilyTemplateDomainPredicates++
    if (block.mode === "lower" && mean > params.lower + EPS) return null
    if (block.mode === "upper" && mean < params.upper - EPS) return null
    if (block.mode === "free" && (mean < params.lower - EPS || mean > params.upper + EPS)) return null
    const value = block.mode === "lower" ? params.lower : block.mode === "upper" ? params.upper : mean
    for (let index = block.first; index <= block.last; index++) lanes[index] = value + index * params.separation
  }
  params.stats.monotoneFamilyAffineLaneInstantiations += lanes.length
  return lanes
}

/** Compile the active set once; later cells validate inequalities and evaluate
 * affine formulas without running a continuous optimizer again. */
export function compileMonotoneLaneTemplate(params: Params): number[] {
  const templates = params.cache.get(params.key) ?? []
  for (const template of templates) {
    params.stats.monotoneFamilyTemplateAttempts++
    const lanes = instantiateTemplate(template, params)
    if (lanes) { params.stats.monotoneFamilyTemplateCacheHits++; return lanes }
    params.stats.monotoneFamilyTemplateDomainRejections++
  }
  params.stats.monotoneFamilyContinuousSolves++
  const blocks: Array<{ first: number; last: number; sum: number; count: number }> = []
  for (let index = 0; index < params.targets.length; index++) {
    blocks.push({ first: index, last: index, sum: params.targets[index]! - index * params.separation, count: 1 })
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]!, previous = blocks[blocks.length - 2]!
      if (previous.sum / previous.count <= last.sum / last.count) break
      blocks.splice(blocks.length - 2, 2, { first: previous.first, last: last.last, sum: previous.sum + last.sum, count: previous.count + last.count })
      params.stats.monotoneFamilyActiveBlockMerges++
    }
  }
  const template: LaneTemplate = { blocks: blocks.map((block) => ({ first: block.first, last: block.last, mode: block.sum / block.count <= params.lower ? "lower" : block.sum / block.count >= params.upper ? "upper" : "free" })) }
  const lanes = instantiateTemplate(template, params)
  if (!lanes) throw new Error("Fresh monotone active set failed its KKT parameter-domain certificate")
  templates.push(template); params.cache.set(params.key, templates)
  params.stats.monotoneFamilyCompiledTemplates++
  params.stats.monotoneFamilyCompiledActiveBlocks += template.blocks.length
  return lanes
}

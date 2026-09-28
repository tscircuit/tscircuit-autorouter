import { createHash } from "node:crypto"
import type { CorpusSample } from "./types"
import { validateSampleTopology } from "./validateSampleTopology"
import { validateControlWitness } from "./validateControlWitness"

export type CorpusValidation = {
  valid: boolean
  sampleCount: number
  pairCount: number
  errors: string[]
  warnings: string[]
  familyCounts: Record<string, number>
  splitCounts: Record<string, number>
  kindCounts: Record<string, number>
  declaredConstraintCounts: Record<string, number>
  exactDuplicateGroups: string[][]
  shapeGroups: string[][]
}

/** Validate corpus bookkeeping and electrical identifiers without claiming boards are routable. */
export function validateCorpus(samples: CorpusSample[]): CorpusValidation {
  const result: CorpusValidation = {
    valid: true,
    sampleCount: samples.length,
    pairCount: 0,
    errors: [],
    warnings: [],
    familyCounts: {},
    splitCounts: {},
    kindCounts: {},
    declaredConstraintCounts: {},
    exactDuplicateGroups: [],
    shapeGroups: [],
  }
  const ids = new Set<string>(),
    familySplits = new Map<string, string>(),
    sources = new Map<string, string>()
  const exactGroups = new Map<string, string[]>(),
    shapeGroups = new Map<string, string[]>()
  for (const sample of samples) {
    const { srj, provenance } = sample
    result.errors.push(
      ...validateSampleTopology(sample),
      ...validateControlWitness(sample),
    )
    if (ids.has(sample.sampleId))
      result.errors.push(`Duplicate sampleId ${sample.sampleId}`)
    ids.add(sample.sampleId)
    if (
      !provenance.sourcePath ||
      !/^[a-f0-9]{64}$/.test(provenance.sourceSha256)
    )
      result.errors.push(`${sample.sampleId}: invalid source provenance`)
    if (!Number.isSafeInteger(provenance.seed))
      result.errors.push(`${sample.sampleId}: seed must be a safe integer`)
    const familySplit = familySplits.get(provenance.familyId)
    if (familySplit && familySplit !== provenance.split)
      result.errors.push(`${provenance.familyId}: family leaks across splits`)
    familySplits.set(provenance.familyId, provenance.split)
    const sourceSplit = sources.get(provenance.sourceSha256)
    if (sourceSplit && sourceSplit !== provenance.split)
      result.errors.push(
        `${sample.sampleId}: identical source hash leaks across splits`,
      )
    sources.set(provenance.sourceSha256, provenance.split)
    result.familyCounts[provenance.familyId] =
      (result.familyCounts[provenance.familyId] ?? 0) + 1
    result.splitCounts[provenance.split] =
      (result.splitCounts[provenance.split] ?? 0) + 1
    result.kindCounts[sample.kind] = (result.kindCounts[sample.kind] ?? 0) + 1
    const exact = createHash("sha256").update(JSON.stringify(srj)).digest("hex")
    exactGroups.set(exact, [...(exactGroups.get(exact) ?? []), sample.sampleId])
    shapeGroups.set(sample.fingerprint, [
      ...(shapeGroups.get(sample.fingerprint) ?? []),
      sample.sampleId,
    ])
    const names = new Set(srj.connections.map((c) => c.name)),
      pairMembership = new Set<string>()
    if (names.size !== srj.connections.length)
      result.errors.push(`${sample.sampleId}: duplicate connection names`)
    if (
      !(
        srj.bounds.minX < srj.bounds.maxX &&
        srj.bounds.minY < srj.bounds.maxY &&
        Number.isInteger(srj.layerCount) &&
        srj.layerCount >= 1
      )
    )
      result.errors.push(`${sample.sampleId}: invalid bounds/layer count`)
    for (const pair of srj.differentialPairs ?? []) {
      result.pairCount++
      if (pair.connectionNames[0] === pair.connectionNames[1])
        result.errors.push(`${sample.sampleId}: pair shorts its two members`)
      for (const name of pair.connectionNames) {
        if (!names.has(name))
          result.errors.push(
            `${sample.sampleId}: pair references missing connection ${name}`,
          )
        if (pairMembership.has(name))
          result.errors.push(
            `${sample.sampleId}: connection ${name} belongs to multiple pairs`,
          )
        pairMembership.add(name)
      }
      for (const key of [
        "lengthTolerance",
        "traceGap",
        "maxUncoupledLength",
      ] as const) {
        const value = pair[key]
        if (value === undefined) continue
        result.declaredConstraintCounts[key] =
          (result.declaredConstraintCounts[key] ?? 0) + 1
        if (!Number.isFinite(value) || value < 0)
          result.errors.push(`${sample.sampleId}: invalid declared ${key}`)
      }
    }
    for (const path of sample.logicalPaths) {
      const positive = new Set(path.positiveConnectionNames),
        negative = new Set(path.negativeConnectionNames)
      if (!positive.size || !negative.size)
        result.errors.push(
          `${sample.sampleId}: empty logical path ${path.pairId}`,
        )
      for (const name of [...positive, ...negative])
        if (!names.has(name))
          result.errors.push(
            `${sample.sampleId}: logical path references missing net ${name}`,
          )
      for (const name of positive)
        if (negative.has(name))
          result.errors.push(
            `${sample.sampleId}: logical path shorts polarities at ${name}`,
          )
      // A resistor can relate two logical nets, but must never merge their copper ownership.
      for (const obstacle of srj.obstacles) {
        const connected = obstacle.connectedTo.filter(
          (name) => positive.has(name) || negative.has(name),
        )
        if (new Set(connected).size > 1)
          result.errors.push(
            `${sample.sampleId}: obstacle joins distinct logical path copper nets ${connected.join("/")}`,
          )
      }
    }
  }
  result.exactDuplicateGroups = [...exactGroups.values()].filter(
    (group) => group.length > 1,
  )
  result.shapeGroups = [...shapeGroups.values()].filter(
    (group) => group.length > 1,
  )
  if (result.exactDuplicateGroups.length)
    result.errors.push(
      `${result.exactDuplicateGroups.length} exact duplicate SRJ groups`,
    )
  if (result.shapeGroups.length)
    result.warnings.push(
      `${result.shapeGroups.length} repeated geometry fingerprint groups; count these by family, not independent boards`,
    )
  result.valid = result.errors.length === 0
  return result
}

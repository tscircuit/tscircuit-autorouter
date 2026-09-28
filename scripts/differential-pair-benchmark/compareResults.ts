import type { RunResults } from "./types"

type ComparisonInput = { current: RunResults; baseline: RunResults; allowDependencyChange?: boolean }

export function compareResults({ current, baseline, allowDependencyChange = false }: ComparisonInput): Record<string, unknown> {
  const fields = ["schemaVersion", "metricVersion", "metricImplementationSha256", "datasetSha256", "dependencyLockSha256", "bunVersion", "config"] as const
  for (const field of fields) {
    if (field === "dependencyLockSha256" && allowDependencyChange) continue
    if (JSON.stringify(current[field]) !== JSON.stringify(baseline[field])) throw new Error(`Baseline incompatible: ${field}`)
  }
  const previous = new Map(baseline.samples.map((sample) => [sample.sampleId, sample]))
  if (previous.size !== current.samples.length) throw new Error("Baseline incompatible: sample count")
  const dependencyChanged = current.dependencyLockSha256 !== baseline.dependencyLockSha256
  const runtimeComparable = JSON.stringify(current.host) === JSON.stringify(baseline.host)
  const changes = current.samples.map((sample) => {
    const old = previous.get(sample.sampleId)
    if (!old || old.fingerprint !== sample.fingerprint) throw new Error(`Baseline incompatible: ${sample.sampleId}`)
    const compliantBefore = old.metrics?.pairs.filter((pair) => pair.fullCompliance === "pass").length ?? 0
    const compliantAfter = sample.metrics?.pairs.filter((pair) => pair.fullCompliance === "pass").length ?? 0
    return { sampleId: sample.sampleId, outputAvailableBefore: old.outputAvailable, outputAvailableAfter: sample.outputAvailable, compliantPairsDelta: compliantAfter - compliantBefore, timedOutBefore: old.timedOut, timedOutAfter: sample.timedOut, durationDeltaMs: runtimeComparable ? sample.durationMs - old.durationMs : null }
  })
  return { dependencyChanged, dependencyChangeExplicitlyAllowed: allowDependencyChange, baselineDependencyLockSha256: baseline.dependencyLockSha256, currentDependencyLockSha256: current.dependencyLockSha256, baselineCommit: baseline.gitCommit, currentCommit: current.gitCommit, runtimeComparable, runtimeNote: "Same reported CPU/OS/Bun is necessary, but external host load is uncontrolled; use a fixed testbox and repeated runs.", changes }
}

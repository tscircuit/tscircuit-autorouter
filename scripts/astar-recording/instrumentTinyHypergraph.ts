import { createHash } from "node:crypto"

// Fail closed if the dependency's search changes: recordings must never silently
// omit a new branch. This is the _step body from the lockfile's 940dbb5 revision.
const EXPECTED_STEP_HASH = "a76b77a113fd40903a80d26016189ce0ae1e6470cdfac81d238bb89b266aa631"

export function instrumentTinyHypergraph(source: string, recorderPath: string): string {
  const start = source.indexOf("  override _step() {")
  const end = source.indexOf("\n  resetCandidateBestCosts()", start)
  const original = source.slice(start, end)
  if (start < 0 || end < 0 || createHash("sha256").update(original).digest("hex") !== EXPECTED_STEP_HASH) {
    throw new Error("A* recorder does not recognize tiny-hypergraph's search loop; update its instrumentation before recording")
  }
  let step = original.replace(
    "    const { problem, topology, state } = this",
    "    const { problem, topology, state } = this\n    const trace = recorder.attach(this)",
  )
  step = step.replace("      this.resetCandidateBestCosts()", "      trace.attempt()\n      this.resetCandidateBestCosts()")
  step = step.replace("      this.onOutOfCandidates()", '      trace.event("frontier-exhausted")\n      this.onOutOfCandidates()')
  step = step.replace(
    "    const currentCandidateHopId =",
    '    trace.event("pop", { candidate: trace.candidate(currentCandidate) })\n    const currentCandidateHopId =',
  )
  step = step.replace(
    "if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) {\n      return",
    'if (currentCandidate.g > this.getCandidateBestCost(currentCandidateHopId)) {\n      trace.event("pop-rejected", { reason: "stale-cost" })\n      return',
  )
  step = step.replace(
    "if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {\n      return",
    'if (this.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {\n      trace.event("pop-rejected", { reason: "region-reserved" })\n      return',
  )
  step = step.replace(
    "    for (const neighborPortId of neighbors) {",
    '    trace.event("expansion", { candidate: trace.candidate(currentCandidate), neighborPortIds: neighbors })\n    for (const neighborPortId of neighbors) {\n      let outcome = "exception"\n      let evaluatedG: number | undefined\n      let bestG: number | undefined\n      try {',
  )
  step = step.replace("if (this.isPortReservedForDifferentNet(neighborPortId)) continue", 'if (this.isPortReservedForDifferentNet(neighborPortId)) { outcome = "port-reserved"; continue }')
  step = step.replaceAll("          continue", '          outcome = "occupied-by-other-net"\n          continue')
  step = step.replace(
    "if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {\n        continue",
    'if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) {\n        outcome = "occupied-by-other-net"\n        continue',
  )
  step = step.replaceAll("        this.onPathFound(", '        outcome = "goal-contact"\n        this.onPathFound(')
  step = step.replace("if (neighborPortId === currentCandidate.portId) continue", 'if (neighborPortId === currentCandidate.portId) { outcome = "same-port"; continue }')
  step = step.replace("if (problem.portSectionMask[neighborPortId] === 0) continue", 'if (problem.portSectionMask[neighborPortId] === 0) { outcome = "outside-section"; continue }')
  step = step.replace("this.isRegionReservedForDifferentNet(nextRegionId)\n      ) {\n        continue", 'this.isRegionReservedForDifferentNet(nextRegionId)\n      ) {\n        outcome = nextRegionId === undefined ? "no-next-region" : "region-reserved"\n        continue')
  step = step.replace("        true\n      ) {\n        continue", '        true\n      ) {\n        outcome = "closed-hop"\n        continue')
  step = step.replace("      if (currentCandidate.g >= previousBestCost) continue", '      bestG = previousBestCost\n      if (currentCandidate.g >= previousBestCost) { outcome = "dominated-before-cost"; continue }')
  step = step.replace("      if (!Number.isFinite(g) || g >= previousBestCost) continue", '      evaluatedG = g\n      if (!Number.isFinite(g) || g >= previousBestCost) { outcome = Number.isFinite(g) ? "dominated-cost" : "nonfinite-cost"; continue }')
  step = step.replace(
    "      state.candidateQueue.queue(newCandidate)\n    }",
    '      state.candidateQueue.queue(newCandidate)\n      outcome = "queued"\n      } finally {\n        trace.event("neighbor", { parentCandidateId: trace.candidate(currentCandidate).id, portId: neighborPortId, outcome, g: evaluatedG, previousBestG: bestG })\n      }\n    }',
  )
  return `import { recorder } from ${JSON.stringify(recorderPath)}\n` + source.slice(0, start) + step + source.slice(end)
}

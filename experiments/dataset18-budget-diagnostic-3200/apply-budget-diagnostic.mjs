import { createHash } from "node:crypto"

export const ORIGINAL_AUTOROUTER_SHA256 = "52eea6a8b25d4af91da1c92790d9c80f674e6ed1aecbf1344738c133033e6310"
const sha = value => createHash("sha256").update(value).digest("hex")

/** Diagnostic allowance only; this is not a proposed production fix. */
export function applyBudgetDiagnostic(source) {
  if (sha(source) !== ORIGINAL_AUTOROUTER_SHA256) throw new Error("Expected untouched published AR1107")
  const original = "MAX_ITERATIONS:Math.ceil(2e6*o*i)"
  const replacement = "MAX_ITERATIONS:Math.ceil(4e6*o*i)"
  if (source.split(original).length !== 2) throw new Error("Solve-graph budget anchor is not unique")
  const candidate = source.replace(original, replacement)
  if (candidate.replace(replacement, original) !== source) throw new Error("Unrelated AR source changed")
  const before = Buffer.from(source), after = Buffer.from(candidate)
  const changedBytes = []
  for (let index = 0; index < before.length; index++) if (before[index] !== after[index]) changedBytes.push(index)
  if (after.length !== before.length || changedBytes.length !== 1 || before[changedBytes[0]] !== 50 || after[changedBytes[0]] !== 52) throw new Error("Expected only one ASCII2-to4 byte change")
  return { source: candidate, proof: {
    inputSha256: sha(source), outputSha256: sha(candidate),
    originalBytes: before.length, candidateBytes: after.length, changedByteOffsets: changedBytes,
    originalAnchor: original, replacementAnchor: replacement,
    diagnosticOnly: true, productionFixProposed: false,
    solveGraphBaseIterations: { before: 2_000_000, after: 4_000_000 },
    effortAndGraphScalingUnchanged: true,
    derivedPipelineIterationsAtEffort1GraphScale1: { before: 4_000_000, after: 6_000_000 },
    existingPortfolioMultiplier: { eligiblePairRouteCounts: [30, 99], multiplier: 2, targetFailurePhase: { glider: 1, imx6: 2 } },
    derivedOuterAdapterIterationsForTargetFailurePhase: { glider: 6_000_000, imx6: 12_000_000 },
    conditionalCostAwareFinalChildIterationsAtEffort1GraphScale1: { before: 4_000_000, after: 8_000_000, existingFormulaUnchanged: true },
    sectionIterationsAtEffort1: 1_000_000, soloPrepassIterationsAtEffort1: 2_000_000, ordinaryGreedyFinalChildIterations: 50_000,
    weightsGraphRulesEffortOrSolverChanged: false, externalDeadlinesChanged: false,
    liveReachabilityGuardAdded: false, newCensusObserverAdded: false,
    onlyOriginalBudgetConstantChanged: true,
  } }
}

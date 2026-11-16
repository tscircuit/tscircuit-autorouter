import { createHash } from "node:crypto"

export const ORIGINAL_CORE_SHA256 = "ca0766b386f4e2d60237c49ef9d1dfe91cb385cfa33ff828fa7b4d8b764d7b0e"

/** Private screen: enumerate pad-edge sites in the existing explicit retry. */
export function applyPadEdgeCandidate(source) {
  const inputSha256 = createHash("sha256").update(source).digest("hex")
  if (inputSha256 !== ORIGINAL_CORE_SHA256) throw new Error("Expected exact published Core2394 bytes")
  const start = source.indexOf("function* expandedSignalSites({")
  const end = source.indexOf("function ", start + 1)
  if (start < 0 || end < 0) throw new Error("Missing expandedSignalSites source boundary")
  const originalFunction = source.slice(start, end)
  let candidateFunction = originalFunction
  const deletedStatements = [
    "    const gridCandidateCount = candidates.length;\n",
    "        if (index2 === gridCandidateCount && ends[end].length) break;\n",
  ]
  for (const statement of deletedStatements) {
    if (candidateFunction.split(statement).length !== 2) throw new Error("Expected one exact pad-edge early-stop statement")
    candidateFunction = candidateFunction.replace(statement, "")
  }
  const originalLoop = "      for (const [index2, point52] of candidates.entries()) {"
  if (candidateFunction.split(originalLoop).length !== 2) throw new Error("Expected one pad-edge candidate loop")
  candidateFunction = candidateFunction.replace(originalLoop, "      for (const point52 of candidates) {")
  if (candidateFunction.includes("gridCandidateCount")) throw new Error("Unexpected remaining grid candidate counter")
  const candidate = source.slice(0, start) + candidateFunction + source.slice(end)
  return {
    source: candidate,
    proof: {
      inputSha256,
      outputSha256: createHash("sha256").update(candidate).digest("hex"),
      originalBytes: Buffer.byteLength(source),
      candidateBytes: Buffer.byteLength(candidate),
      changedFunction: "expandedSignalSites",
      deletedStatements: deletedStatements.map(statement => statement.trim()),
      unusedLoopIndexRemoved: true,
      regularCandidateOrderAndGeometryUnchanged: true,
      explicitPadEdgeRetryOnly: true,
      pourOrAntipadChanges: false,
      observersAdded: false,
      optionsRulesAndBudgetsChanged: false,
      outsideFunctionUnchanged: candidate.slice(0, start) === source.slice(0, start) && candidate.slice(start + candidateFunction.length) === source.slice(end),
    },
  }
}

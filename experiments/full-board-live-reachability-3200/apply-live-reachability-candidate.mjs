import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const ORIGINAL_AUTOROUTER_SHA256 = "52eea6a8b25d4af91da1c92790d9c80f674e6ed1aecbf1344738c133033e6310"
const sha = value => createHash("sha256").update(value).digest("hex")

/** Adapt the frozen two-file Tiny change to its exact published AR instance. */
export function applyLiveReachabilityCandidate(source) {
  if (sha(source) !== ORIGINAL_AUTOROUTER_SHA256) throw new Error("Expected exact published AR1107 bytes")
  const freeze = JSON.parse(readFileSync(join(import.meta.dir, "source-freeze.json"), "utf8"))
  const helperSource = readFileSync(join(import.meta.dir, "helper-source.ts.txt"), "utf8")
  if (!freeze.frozen || !freeze.baselineProductionFilesMatch || sha(helperSource) !== freeze.helperFragmentSha256) throw new Error("Helper differs from the frozen Tiny source")
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" })
  const compiled = transpiler.transformSync(helperSource)
  const exports = transpiler.scan(compiled)
  if (exports.imports.length !== 0 || exports.exports.length !== 1 || exports.exports[0] !== "hasCurrentRouteReachabilityPath") throw new Error("Expected one pure source helper export")
  const declaration = "export const hasCurrentRouteReachabilityPath ="
  if (compiled.split(declaration).length !== 2 || source.includes("hasCurrentRouteReachabilityPath")) throw new Error("Helper declaration is not uniquely internal")
  const helper = compiled.replace(declaration, "const hasCurrentRouteReachabilityPath =") + "\n"
  const original = "const i=this.getHopId(t,o);this.setCandidateBestCost(i,0),n.candidateQueue.queue({hopId:i,nextRegionId:o,portId:t,f:0,g:0,h:0}),n.goalPortId=this.getRouteEndPortId(n.currentRouteId)}const o=n.candidateQueue.dequeue();"
  const replacement = "n.goalPortId=this.getRouteEndPortId(n.currentRouteId);if(!hasCurrentRouteReachabilityPath({topology:this.topology,problem:e,problemSetup:this.problemSetup,portAssignment:n.portAssignment,routeNetId:n.currentRouteNetId,startPortId:t,goalPortId:n.goalPortId,startRegionId:o})){this.onOutOfCandidates();return}const i=this.getHopId(t,o);this.setCandidateBestCost(i,0),n.candidateQueue.queue({hopId:i,nextRegionId:o,portId:t,f:0,g:0,h:0})}const o=n.candidateQueue.dequeue();"
  if (source.split(original).length !== 2) throw new Error("Native Tiny route-initialization anchor is not unique")
  const candidate = helper + source.replace(original, replacement)
  const restored = candidate.slice(helper.length).replace(replacement, original)
  if (restored !== source) throw new Error("Unrelated published AR bytes changed")
  new Bun.Transpiler({ loader: "js", target: "bun" }).scan(candidate)
  return {
    source: candidate,
    proof: {
      inputSha256: sha(source), outputSha256: sha(candidate),
      originalBytes: Buffer.byteLength(source), candidateBytes: Buffer.byteLength(candidate),
      tinyBaselineCommit: freeze.baselineTinyCommit, tinySourceHead: freeze.head,
      tinySourceFiles: { "lib/core.ts": freeze.files["lib/core.ts"], "lib/static-reachability.ts": freeze.files["lib/static-reachability.ts"] },
      helperFragmentSha256: sha(helperSource), helperJavascriptSha256: sha(helper),
      compiler: `Bun ${Bun.version} Transpiler`,
      changedMethod: "TinyHyperGraphSolver._step route initialization",
      existingRecoveryMethod: "onOutOfCandidates",
      unrelatedPublishedBytesUnchanged: true,
      olderNestedTinyCopyUnchanged: true,
      weightsGraphRulesAndBudgetsChanged: false,
      newSolverOrStrategyAdded: false,
      additionalObserverAdded: false,
    },
  }
}

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { checkViasOffBoard } from "@tscircuit/checks"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { NetToPointPairsSolver } from "../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import { createSrjWithBoardValidObstacleLayers } from "../lib/utils/create-srj-with-board-valid-obstacle-layers"

const args = process.argv.slice(2)
const argument = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const inputPath = resolve(argument("--input") ?? "/workspace/sample24-audit-original.srj.json")
const outputDirectory = argument("--out-dir")
if (!outputDirectory) throw new Error("Required --out-dir PATH; optionally --routes FINAL.srj.json")
mkdirSync(outputDirectory, { recursive: true })
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")
const inputBytes = readFileSync(inputPath)
const inputSha256 = hash(inputBytes)
if (inputSha256 !== "ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7") throw new Error("Original sample24 input hash mismatch")
const input = JSON.parse(inputBytes.toString())
if (input.traces?.length || input.jumpers?.length || input.layerCount !== 8 || input.allowBlindAndBuriedVias !== false) throw new Error("Unexpected original board policy")
const sourceNormalizedOriginal = createSrjWithBoardValidObstacleLayers(input)
// Source P9 exports its originalSrj after exact board-layer normalization. Verify
// every immutable raw field independently before accepting those derived caches.
const rawPhysicalAndNestedFieldMismatches: string[] = []
for (const key of Object.keys(input)) {
  if (key === "obstacles") continue
  if (!isDeepStrictEqual(input[key], sourceNormalizedOriginal[key])) rawPhysicalAndNestedFieldMismatches.push(key)
}
if (sourceNormalizedOriginal.obstacles.length !== input.obstacles.length) throw new Error("Source normalization changed raw obstacle count")
for (let index=0;index<input.obstacles.length;index++) {
  const original=input.obstacles[index],normalized=sourceNormalizedOriginal.obstacles[index]
  for(const key of Object.keys(original)) if(!isDeepStrictEqual(original[key],normalized[key])) rawPhysicalAndNestedFieldMismatches.push(`obstacles[${index}].${key}`)
  for(const key of Object.keys(normalized)) if(!(key in original) && key!=="zLayers" && key!=="__zLayers")rawPhysicalAndNestedFieldMismatches.push(`obstacles[${index}].extra.${key}`)
}
if(rawPhysicalAndNestedFieldMismatches.length)throw new Error("Exact source normalization altered immutable raw fields: "+rawPhysicalAndNestedFieldMismatches.join(","))
const exactSourceNormalizationProof={sourceFunction:"createSrjWithBoardValidObstacleLayers",sourceFunctionSha256:hash(readFileSync("lib/utils/create-srj-with-board-valid-obstacle-layers.ts")),rawPhysicalAndNestedFieldMismatches,rawFieldsAllPreserved:true,onlyAbsentDerivedObstacleLayerCachesAdded:true,originalObstacleCount:input.obstacles.length,normalizedOriginalSha256:hash(JSON.stringify(sourceNormalizedOriginal)),qualification:"Raworiginal remains authoritative. Every original raw root/obstacle field including dimensions,positions,rotation,layers,ownership and nested metadata is deep-equal after the exact source function; only derived zLayers/__zLayers absent in raw may be added. Finalexport is compared to that exact source-normalized original."}
const terminalIds = input.connections.flatMap((connection: any) => connection.pointsToConnect.map((point: any) => point.pcb_port_id))
if (terminalIds.length !== 2343 || new Set(terminalIds).size !== 2343 || input.connections.length !== 409 || input.obstacles.length !== 4418) throw new Error("Original roster count mismatch")
// No original routed copper is present. Desired net aliases must never serve
// as evidence of already existing physical connectivity.
const pairs = new NetToPointPairsSolver(input, {}, new ConnectivityMap({}))
pairs.solve()
if (!pairs.solved || pairs.failed || pairs.newConnections.length !== 1934) throw new Error("Original MST roster generation failed")
const pairSrj = pairs.getNewSimpleRouteJson()
const sourcePaths = [
  "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver.ts",
  "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree.ts",
  "lib/testing/evaluate-relaxed-drc.ts", "lib/testing/getDrcErrors.ts",
  "lib/testing/getUnownedObstacleDrcErrors.ts", "lib/testing/utils/convertToCircuitJson.ts",
  "lib/utils/isOpaqueUnownedObstacle.ts", "lib/testing/drcPresets.ts",
  "lib/utils/getViaDimensions.ts", "lib/utils/create-srj-with-board-valid-obstacle-layers.ts",
  "node_modules/@tscircuit/checks/dist/index.js",
  "node_modules/circuit-json-to-connectivity-map/dist/index.js",
  "node_modules/@tscircuit/repair04/lib/getFixedObstacleViolations.ts",
  "node_modules/@tscircuit/repair04/lib/obstacleDistanceGeometry.ts",
  "node_modules/high-density-repair03/lib/utils/getViaLayers.ts",
]
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, hash(readFileSync(path))]))
const roster = {
  scope: "ORIGINAL_SAMPLE24_MST_OBLIGATIONS_NO_ROUTING",
  inputPath, inputSha256, netCount: 409, terminalCount: 2343, expectedPairCount: 1934,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceHashes, exactSourceNormalizationProof,
  pairs: pairs.newConnections.map((connection: any) => ({
    name: connection.name,
    owner: connection.__netConnectionName ?? connection.__rootConnectionNames?.[0] ?? connection.name,
    points: connection.pointsToConnect,
  })),
}
const rosterPath = resolve(outputDirectory, "original-mst-roster.json")
writeFileSync(rosterPath, JSON.stringify(roster, null, 2) + "\n", { flag: "wx" })
const routesArgument = argument("--routes")
if (!routesArgument) {
  console.log(JSON.stringify({ rosterPath, inputSha256, pairCount: roster.pairs.length, routingStarted: false }))
} else {
  const routesPath = resolve(routesArgument)
  const finalBytes = readFileSync(routesPath)
  const final = JSON.parse(finalBytes.toString())
  if (!Array.isArray(final.traces)) throw new Error("Expected an actual final SRJ object with traces")
  const originalFieldMismatches = Object.keys(input).filter((key) => !isDeepStrictEqual(sourceNormalizedOriginal[key], final[key]))
  if (originalFieldMismatches.length) throw new Error("Final SRJ altered original board fields: " + originalFieldMismatches.join(","))
  const traceClearance = input.minTraceToPadEdgeClearance ?? 0.1
  const viaPadClearance = input.minViaEdgeToPadEdgeClearance ?? input.minPadEdgeToPadEdgeClearance ?? 0.1
  const drc = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: pairSrj, routedTraces: final.traces,
    includeBoardClearance: true,
    drcOptions: { traceClearance, viaPadClearance, viaClearance: 0.1 } })
  // Trace copper is checked by getDrcErrors. Add manufactured vias only;
  // baseline source pad placement is outside the new-route acceptance scope.
  const additionalBoardErrors = checkViasOffBoard(drc.circuitJson)
  const errors = [...drc.errors, ...additionalBoardErrors]
  const circuitJsonCounts = Object.fromEntries([...new Set(drc.circuitJson.map((element) => element.type))].map((type) => [type, drc.circuitJson.filter((element) => element.type === type).length]))
  if (circuitJsonCounts.pcb_smtpad !== 2362 || circuitJsonCounts.pcb_plated_hole !== 132 || circuitJsonCounts.pcb_hole !== 6 || circuitJsonCounts.pcb_port !== 2343) throw new Error("Reference converter omitted an original typed pad, hole or terminal")
  const result = {
    scope: "FINAL_CAPTURE_REFERENCE_DRC_SUPPLEMENT_NOT_INDEPENDENT_CONNECTIVITY",
    inputPath, inputSha256, routesPath, routesSha256: hash(finalBytes), originalFieldMismatches, exactSourceNormalizationProof,
    sourceRevision: roster.sourceRevision, sourceHashes, rosterPath,
    physicalRules: { traceClearance, viaPadClearance, viaClearance: 0.1, boardEdgeClearance: input.minBoardEdgeClearance ?? 0,
      referenceTraceToNonPlatedHoleClearance: input.minTraceToHoleEdgeClearance ?? 0.2,
      planningMarginNotEnforced: 0.15, engineTraceTolerance: 0.005 },
    traceCount: final.traces.length, circuitJsonCounts,
    errorCount: errors.length,
    errorCountsByType: Object.fromEntries([...new Set(errors.map((error) => error.type))].map((type) => [type, errors.filter((error) => error.type === type).length])),
    errors, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    qualification: "Uses the corrected local reference converter/checks plus opaque-unowned zero-extra-clearance supplement. Through-obstacle route primitives are omitted by Circuit JSON and need the independent projection audit. Contiguity and metadata do not prove all original terminals are physically connected; run the electrical/terminal audit separately. No routing was run; --routes is not evidence of pipeline completion.",
  }
  const reportPath = resolve(outputDirectory, "final-reference-drc.json")
  writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ reportPath, routesSha256: result.routesSha256, traceCount: result.traceCount, errorCount: result.errorCount, peakRssBytes: result.peakRssBytes }))
  process.exitCode = errors.length ? 1 : 0
}

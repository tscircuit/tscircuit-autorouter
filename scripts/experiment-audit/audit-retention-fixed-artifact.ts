import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { evaluateRelaxedDrc, combinePreloadedAndRoutedTraces } from "../../lib/testing/evaluate-relaxed-drc"

type Json = any
const SOURCE = "74de6cea4bd39c9aa41e9d492b003a892abd1596"
const CONTROLLER = "6d28137e8f8725cde18e156cbf986892615d25fb"
const RUN = "40752626904"
const CHECKS_PACKAGE_HASH = "c83f6093d19356d8d9b549eefab2d8fd043f70ecb28b6b891fa54c2542757945"
const VALIDATORS: Record<string, string> = {
  "lib/testing/evaluate-relaxed-drc.ts": "d774e4d05931e0e24b2462e9436c9b0aba604aafddc88c99e67e588a4c2fcd59",
  "lib/testing/getDrcErrors.ts": "8f3aba2532e216d530db5efe3d514ec114f33b4ac0e32d68170522660257a994",
  "lib/testing/drcPresets.ts": "28676dfc06a0ce9c31139d7e5745d872c8d27fe0c5f3972360a4fd1ce73518bf",
  "lib/testing/utils/convertToCircuitJson.ts": "ed6f4c1e7506c7aea52679dc52a0af80af8cacdfc638bb74c852208ba7e32212",
  "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts": "6ce2359e7c76d888cf9a8c91aee28750ea8b083ed09e6913b8446266bb779f13",
}
const EXPECTED: Record<string, { input: string; output: string; traces: string }> = {
  "14A": { input: "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e", output: "f806cf2415bc50e62360917de6d629775d6f1cfa7047d6a5a4ba673206c16d57", traces: "e3bb5f4784ee6d6fdc538fc39f09ef4f5a9e2c36705a3ae97b225735b76597e6" },
  "14B": { input: "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e", output: "fddfe5c3cd2d37dbac1f47b65a96d7527bee14c88d40132108b381ab8f38d863", traces: "fc2ccedd14c9284ccee18f7b7b8377ebe0757927d6fc1ddc2025c8c0f93d59e6" },
  "15A": { input: "29888a7ecc6fa589e1ff0bfb24187c086cfceb2246756ec5bdf69d4bc4d5f6df", output: "e8e264b19cad7cb0f0a6558f030aa9f722ea3d33eb106149532a3c9c66f26b1c", traces: "9ad23a7012ad4d582673af6ea167862785201cbe1782540a4254907c71343b7f" },
  "15B": { input: "29888a7ecc6fa589e1ff0bfb24187c086cfceb2246756ec5bdf69d4bc4d5f6df", output: "55dfa0de09ef9255d1f2c7cc90562b36ddebeb0f1fcd67834c9d1cd57df3246c", traces: "eb8b9faf6b38d5ab18994d5d04276912909f425791a37d1aaed9c79920debde6" },
}
const sha = (value: string): string => createHash("sha256").update(value).digest("hex")
const json = (path: string): Json => JSON.parse(readFileSync(path, "utf8"))
const bytesHash = (path: string): string => sha(readFileSync(path, "utf8"))
const strings = (values: Json[]): string[] => values.filter((x): x is string => typeof x === "string" && x.length > 0)
const sorted = (values: string[]): string[] => [...new Set(values)].sort()

// Electrical components come ONLY from original declared connections and typed
// terminal IDs. No coordinate matching, rounded helper IDs, processed aliases,
// obstacle connectivity_net tokens or physical contact can union owners.
export function originalOwners(original: Json) {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key)
    const previous = parent.get(key)!
    if (previous !== key) parent.set(key, find(previous))
    return parent.get(key)!
  }
  const unite = (a: string, b: string) => {
    const ar = find(a), br = find(b)
    if (ar !== br) parent.set(br, ar)
  }
  const registry = new Map<string, Set<string>>()
  const declare = (type: string, value: Json, owner: string) => {
    if (typeof value !== "string" || !value) return
    const key = JSON.stringify([type, value])
    unite(owner, key)
    if (!registry.has(value)) registry.set(value, new Set())
    registry.get(value)!.add(key)
  }
  original.connections.forEach((connection: Json, index: number) => {
    const owner = `original-connection:${index}`
    find(owner)
    declare("connection-name", connection.name, owner)
    declare("source-trace", connection.source_trace_id, owner)
    declare("source-net", connection.source_net_id, owner)
    for (const point of connection.pointsToConnect ?? []) {
      declare("pcb-port", point.pcb_port_id, owner)
      declare("point-id", point.pointId, owner)
      declare("source-port", point.source_port_id, owner)
    }
  })
  const names = new Map<string, string[]>()
  original.connections.forEach((connection: Json, index: number) => {
    const owner = find(`original-connection:${index}`)
    names.set(owner, sorted([...(names.get(owner) ?? []), connection.name]))
  })
  const resolveTokens = (tokens: { type?: string; value: Json }[]) => {
    const roots = new Set<string>()
    const proof: string[] = []
    for (const { type, value } of tokens) {
      if (typeof value !== "string") continue
      const keys = type ? [JSON.stringify([type, value])].filter((key) => parent.has(key)) : [...(registry.get(value) ?? [])]
      for (const key of keys) { roots.add(find(key)); proof.push(key) }
    }
    return { status: roots.size === 1 ? "resolved" : roots.size ? "ambiguous" : "unknown", owners: [...roots].map((root) => (names.get(root) ?? [root]).join("|" )).sort(), proof: sorted(proof) }
  }
  return {
    resolveTokens,
    trace: (trace: Json) => resolveTokens([{ type: "connection-name", value: trace.connection_name }, { type: "source-trace", value: trace.source_trace_id }]),
    obstacle: (obstacle: Json) => resolveTokens([
      { type: "pcb-port", value: obstacle.circuitJsonMetadata?.pcb_port_id },
      ...strings(obstacle.connectedTo ?? []).map((value) => ({ value })),
    ]),
  }
}

// Independent circle-to-oriented-rectangle/circle signed surface distance.
// This uses original obstacle geometry, not the checker's distance helper.
export function viaObstacleGap(via: Json, obstacle: Json): number {
  const radius = via.outer_diameter / 2
  assert(Number.isFinite(radius) && radius > 0, "Nonfinite via pad radius")
  const dx = via.x - obstacle.center.x, dy = via.y - obstacle.center.y
  if ((obstacle.shape ?? obstacle.type) === "circle") return Math.hypot(dx, dy) - obstacle.width / 2 - radius
  assert(["rect", "rectangle", undefined].includes(obstacle.shape ?? obstacle.type), "Unsupported original pad shape")
  const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const localX = Math.cos(angle) * dx + Math.sin(angle) * dy
  const localY = -Math.sin(angle) * dx + Math.cos(angle) * dy
  const ex = Math.abs(localX) - obstacle.width / 2
  const ey = Math.abs(localY) - obstacle.height / 2
  return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - radius
}

function obstacleForPad(original: Json, pad: Json): { obstacle: Json; index: number } {
  const id = pad.pcb_smtpad_id ?? pad.pcb_plated_hole_id
  const matches = original.obstacles.flatMap((obstacle: Json, index: number) => {
    const metadata = obstacle.circuitJsonMetadata ?? {}
    const baseId = metadata.pcb_smtpad_id ?? metadata.pcb_plated_hole_id
    const fragmentId = baseId && `${baseId}_fragment_${index}`
    return id === baseId || id === fragmentId ? [{ obstacle, index }] : []
  })
  // Exact physical identity disambiguates fragments of the SAME declared pad.
  // It is never used to union or infer electrical ownership.
  const physical = matches.filter(({ obstacle }: Json) => obstacle.center.x === pad.x && obstacle.center.y === pad.y)
  assert.equal(physical.length, 1, "Pad must map uniquely to original declared pad ID and exact geometry")
  const result = physical[0]
  const obstacle = result.obstacle
  if (pad.type === "pcb_smtpad") {
    if (pad.shape === "circle") assert.equal(pad.radius * 2, obstacle.width)
    else { assert.equal(pad.width, obstacle.width); assert.equal(pad.height, obstacle.height) }
  } else if (pad.shape === "circle") assert.equal(pad.outer_diameter, Math.max(obstacle.width, obstacle.height))
  else { assert.equal(pad.rect_pad_width, obstacle.width); assert.equal(pad.rect_pad_height, obstacle.height) }
  return result
}

function fullLayers(count: number): string[] {
  return ["top", ...Array.from({ length: count - 2 }, (_, index) => `inner${index + 1}`), "bottom"]
}

export function strictCopperMetrics(original: Json, traces: Json[]) {
  const owners = originalOwners(original)
  const sites = new Set<string>(), coordinateOwners = new Map<string, Set<string>>(), segments = new Map<string, number>()
  let emittedVias = 0, unresolvedTraceOwners = 0, rawLength = 0
  const traceOwners: Json[] = []
  for (const trace of combinePreloadedAndRoutedTraces(original.traces ?? [], traces)) {
    const identity = owners.trace(trace)
    if (identity.status !== "resolved") unresolvedTraceOwners++
    const owner = identity.status === "resolved" ? identity.owners[0] : `UNRESOLVED:${trace.pcb_trace_id}`
    traceOwners.push({ trace, identity })
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index], next = trace.route[index + 1]
      if (point.route_type === "via") {
        emittedVias++
        assert(fullLayers(original.layerCount).includes(point.from_layer) && fullLayers(original.layerCount).includes(point.to_layer) && point.from_layer !== point.to_layer, "Invalid via layer transition")
        assert(original.allowBlindAndBuriedVias !== true, "Independent full-stack metric requires through-via input")
        const diameter = point.via_diameter ?? original.min_via_pad_diameter ?? original.minViaPadDiameter ?? original.minViaDiameter ?? 0.3
        const hole = point.via_hole_diameter ?? original.min_via_hole_diameter ?? original.minViaHoleDiameter ?? diameter * 0.5
        assert(diameter > 0 && hole > 0 && hole <= diameter, "Invalid via dimensions")
        const coordinates = JSON.stringify([point.x, point.y, fullLayers(original.layerCount)])
        sites.add(JSON.stringify([owner, point.x, point.y, fullLayers(original.layerCount), diameter, hole]))
        if (!coordinateOwners.has(coordinates)) coordinateOwners.set(coordinates, new Set())
        coordinateOwners.get(coordinates)!.add(owner)
      }
      if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
        const length = Math.hypot(next.x - point.x, next.y - point.y)
        rawLength += length
        const ends = [[point.x, point.y, point.width], [next.x, next.y, next.width]].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
        segments.set(JSON.stringify([owner, point.layer, ends]), length)
      }
    }
  }
  return { summary: { emittedVias, uniqueOwnedManufacturedSites: sites.size, unresolvedTraceOwners, traceCount: traceOwners.length, foreignOwnerCoincidentSites: [...coordinateOwners.values()].filter((set) => set.size > 1).length, rawSameLayerWireLengthMm: rawLength, exactWidthPreservingSegmentDeduplicatedWireLengthMm: [...segments.values()].reduce((a, b) => a + b, 0) }, traceOwners }
}

function comparablePadErrors(errors: Json[]): string[] {
  return errors.filter((error) => error.type === "pcb_pad_pad_clearance_error").map((error) => JSON.stringify([error.type, sorted(error.pcb_pad_ids), error.message])).sort()
}

async function main() {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const artifactRoot = resolve(process.argv[2] ?? "")
  assert(process.argv[2], "Extracted artifact root is required")
  const candidates = [artifactRoot, ...readdirSync(artifactRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(artifactRoot, entry.name))].filter((path) => existsSync(join(path, "provenance.json")))
  assert.equal(candidates.length, 1, "Expected one campaign root")
  const campaign = candidates[0], provenance = json(join(campaign, "provenance.json"))
  assert.equal(String(provenance.githubRunId), RUN)
  assert.equal(provenance.controllerSha, CONTROLLER)
  assert.equal(provenance.dataset, "srj18")
  assert.equal(provenance.executionOrder, "AB")
  assert.deepEqual(provenance.selectedInputPopulation.map((row: Json) => row.sampleNumber), [14, 15])
  const validators: Record<string, string> = {}
  for (const [path, expected] of Object.entries(VALIDATORS)) {
    validators[path] = bytesHash(join(sourceRoot, path))
    assert.equal(validators[path], expected, `Audit source changed validator: ${path}`)
    for (const arm of ["A", "B"]) assert.equal(provenance.harnesses[arm].validators[path], expected, `Archived validator mismatch ${arm}:${path}`)
  }
  for (const arm of ["A", "B"]) {
    assert.equal(provenance.harnesses[arm].checkoutSha, SOURCE)
    const archived = provenance.harnesses[arm].dependencyResolution.directDependencies["@tscircuit/checks"]
    assert.equal(archived.packageJsonSha256, CHECKS_PACKAGE_HASH)
    assert.equal(bytesHash(join(sourceRoot, "node_modules/@tscircuit/checks/package.json")), archived.packageJsonSha256)
    for (const dependency of ["circuit-json", "@tscircuit/math-utils", "@tscircuit/circuit-json-util", "circuit-json-to-connectivity-map", "high-density-repair03"]) {
      const record = provenance.harnesses[arm].dependencyResolution.directDependencies[dependency]
      if (record && !record.missingPackageJson) assert.equal(bytesHash(join(sourceRoot, "node_modules", dependency, "package.json")), record.packageJsonSha256, `Geometry dependency changed: ${dependency}`)
    }
  }
  const rows = readFileSync(join(campaign, "results.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((row) => `${row.sampleNumber}${row.arm}`), ["14A", "14B", "15A", "15B"])
  const reports: Json[] = []
  for (const row of rows) {
    const key = `${row.sampleNumber}${row.arm}`, expected = EXPECTED[key]
    assert(expected, "Unexpected sample/arm")
    assert.equal(row.sha, SOURCE); assert.equal(row.dataset, "srj18"); assert.equal(row.round, 1); assert.equal(row.executionOrder, "AB")
    const raw = join(campaign, `round-1/sample-${String(row.sampleNumber).padStart(3, "0")}/${row.arm}/raw`)
    const original = json(join(raw, "original-input.json")), pairs = json(join(raw, "point-pair-context.json")), traces = json(join(raw, "raw-new-traces.json")), capture = json(join(raw, "capture-provenance.json")), supplemental = json(join(raw, "supplemental-validation.json"))
    for (const [file, hash] of [["original-input.json", expected.input], ["raw-solver-output.json", expected.output], ["raw-new-traces.json", expected.traces]]) assert.equal(bytesHash(join(raw, file)), hash, `Raw hash mismatch ${key}:${file}`)
    assert.equal(capture.inputHash, expected.input); assert.equal(capture.rawOutputHash, expected.output); assert.equal(capture.rawNewTracesHash, expected.traces)
    assert.equal(capture.inputMutated, false); assert.equal(capture.solverSolved, true); assert.equal(capture.solverFailed, false); assert.equal(capture.solverError, null)
    assert.deepEqual(capture.options, { cacheProvider: null, effort: 1, retainBestPartialRouting: row.arm === "B" })
    const evaluated = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pairs, routedTraces: traces, includeBoardClearance: true, drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance, includeTraceContinuity: true, includeTypedTraceClearance: true } })
    assert.equal(evaluated.errors.length, 0, "Original reference checks changed")
    const library = await runAllRoutingChecks(structuredClone(evaluated.circuitJson))
    assert.deepEqual(comparablePadErrors(library), comparablePadErrors(supplemental.libraryRoutingChecks.errors), `Saved via-pad findings do not reproduce: ${key}`)
    const padErrors = library.filter((error: Json) => error.type === "pcb_pad_pad_clearance_error")
    assert.equal(padErrors.length, row.sampleNumber === 14 ? (row.arm === "A" ? 0 : 5) : (row.arm === "A" ? 13 : 0))
    const ownerMap = originalOwners(original), copper = strictCopperMetrics(original, traces)
    const objects = new Map(evaluated.circuitJson.map((element: Json) => [element.pcb_via_id ?? element.pcb_smtpad_id ?? element.pcb_plated_hole_id, element]))
    const traceById = new Map(copper.traceOwners.map((entry: Json) => [entry.trace.pcb_trace_id, entry]))
    const findings = row.sampleNumber === 14 ? padErrors.map((error: Json) => {
      const [viaId, padId] = error.pcb_pad_ids, via: Json = objects.get(viaId), pad: Json = objects.get(padId)
      assert.equal(via?.type, "pcb_via"); assert(["pcb_smtpad", "pcb_plated_hole"].includes(pad?.type))
      const { obstacle, index } = obstacleForPad(original, pad)
      const padOwner = ownerMap.obstacle(obstacle), viaTrace: Json = traceById.get(via.pcb_trace_id)
      assert(viaTrace, "Via trace not present in raw original-owned copper")
      const viaOwner = viaTrace.identity, gap = viaObstacleGap(via, obstacle)
      assert(Math.abs(Math.max(0, gap) - error.actual_clearance) < 1e-7, "Independent original-geometry nonnegative surface gap disagrees with library")
      assert.deepEqual(sorted(via.layers), sorted(fullLayers(original.layerCount)))
      const sharedLayers = via.layers.filter((layer: string) => obstacle.layers.includes(layer))
      assert(sharedLayers.length > 0)
      const verdict = viaOwner.status !== "resolved" || padOwner.status !== "resolved" ? "OWNERSHIP_UNRESOLVED" : viaOwner.owners[0] === padOwner.owners[0] ? "SAME_ORIGINAL_OWNER_CHECKER_ASSOCIATION_REVIEW_NEEDED" : "FOREIGN_ORIGINAL_OWNER_CLEARANCE_VIOLATION"
      return { errorId: error.pcb_pad_pad_clearance_error_id, viaId, padId, traceId: via.pcb_trace_id, originalObstacleIndex: index, viaOwner, padOwner, verdict, signedOriginalGeometryCopperGapMm: gap, libraryNonnegativeCopperGapMm: error.actual_clearance, requiredCopperGapMm: error.minimum_clearance, toleranceMm: 0.005, viaOuterDiameterMm: via.outer_diameter, viaHoleDiameterMm: via.hole_diameter, manufacturedViaLayers: via.layers, originalPadLayers: obstacle.layers, sharedLayers, originalPadShape: obstacle.shape ?? obstacle.type ?? "rect", originalPadWidthMm: obstacle.width, originalPadHeightMm: obstacle.height, originalPadRotationDegrees: obstacle.ccwRotationDegrees ?? 0 }
    }) : []
    if (row.sampleNumber === 15) {
      assert.equal(copper.summary.unresolvedTraceOwners, 0)
      assert.equal(copper.summary.emittedVias, row.arm === "A" ? 342 : 299)
      assert.equal(copper.summary.uniqueOwnedManufacturedSites, row.arm === "A" ? 324 : 275)
      assert.equal(copper.summary.foreignOwnerCoincidentSites, 0)
    }
    reports.push({ sample: row.sampleNumber, arm: row.arm, source: SOURCE, hashes: expected, referenceErrorCount: evaluated.errors.length, libraryPadErrorCount: padErrors.length, originalOwnershipCopper: copper.summary, findings })
  }
  console.log("RETENTION_FIXED_ARTIFACT_AUDIT_JSON " + JSON.stringify({ status: "AUDIT_COMPLETE_NO_SOLVER_RUN", archivedRun: RUN, archivedController: CONTROLLER, source: SOURCE, validatorHashes: validators, checksPackageSha256: CHECKS_PACKAGE_HASH, reports, limits: "Original reference validators unchanged. Re-evaluates retained raw copper only; no routing or timing run. Typed original connection/terminal declaration components define owners; coordinates are used only for physical distance and exact pad-fragment identity. Supplemental rule outcomes remain separate from official benchmark qualification." }))
}

if (import.meta.main) await main()

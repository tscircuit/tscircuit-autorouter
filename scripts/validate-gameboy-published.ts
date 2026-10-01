import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  AUTOROUTER_VERSION,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
} from "published-autorouter"
import {
  AutoroutingDrcEngine,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "../lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "../lib/types"

// Validation only: no private TSX, Core/eval execution, or repository solver.
const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error("Expected an output directory")
mkdirSync(outputDirectory, { recursive: true })
const inputText = readFileSync(
  "tests/repro/assets/gameboy-full-board-through-vias.srj.json",
  "utf8",
)
const inputHash = createHash("sha256").update(inputText).digest("hex")
if (
  inputHash !==
  "89cfabf40f44453f4894a67475c4a5563e171d629f52bd42a8724bb15185ace4"
) {
  throw new Error("The public historical Game Boy input has changed")
}
const inputSrj = JSON.parse(inputText) as SimpleRouteJson
if (
  inputSrj.layerCount !== 4 ||
  inputSrj.allowBlindAndBuriedVias !== false ||
  inputSrj.connections.length !== 144 ||
  inputSrj.obstacles.length !== 477 ||
  inputSrj.traces !== undefined
) {
  throw new Error("Unexpected board input or preloaded copper")
}

const routerEntry = import.meta.resolve("published-autorouter")
const routerPackagePath = resolve(
  dirname(new URL(routerEntry).pathname),
  "..",
  "package.json",
)
const routerPackage = JSON.parse(readFileSync(routerPackagePath, "utf8"))
if (routerPackage.version !== "0.0.951" || AUTOROUTER_VERSION !== "0.0.951") {
  throw new Error("Expected the published autorouter 0.0.951 bundle")
}
const routerBundleSha256 = createHash("sha256")
  .update(readFileSync(new URL(routerEntry)))
  .digest("hex")
if (
  routerBundleSha256 !==
  "da5c3fff3e4f4b835f2363c6d4acaff6c39f22ee79a36890361ccebc1d9b5c20"
) {
  throw new Error("Router bytes differ from the integrity-verified npm tarball")
}
const provenance = {
  scope: "public captured SRJ; router-only, not Core/eval regeneration",
  inputHash,
  routerEntry,
  routerVersion: routerPackage.version,
  routerSourceCommit: "785dad5e35bfc692758128d4a08c67763b122331",
  routerBundleSha256,
  repair03SourceCommit: "ccad3906eb0fe30c9f79f4e28f390d9f41cbf387",
  platform: process.platform,
  arch: process.arch,
  bun: Bun.version,
  pipeline: 9,
  effort: 1,
  cacheProvider: null,
  checksPackage: JSON.parse(
    readFileSync("node_modules/@tscircuit/checks/package.json", "utf8"),
  ),
  repair03Package: JSON.parse(
    readFileSync("node_modules/high-density-repair03/package.json", "utf8"),
  ),
}
writeFileSync(
  `${outputDirectory}/provenance.json`,
  JSON.stringify(provenance, null, 2),
)
writeFileSync(`${outputDirectory}/input.srj.json`, inputText)
console.log("GAMEBOY_START", JSON.stringify(provenance))

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
  cacheProvider: null,
  effort: 1,
})
const startedAt = performance.now()
solver.solve()
const durationMs = performance.now() - startedAt
if (!solver.solved || solver.failed || solver.error) {
  throw new Error(`Published Game Boy solve did not complete: ${solver.error}`)
}
if (!solver.srjWithPointPairs) throw new Error("Missing point-paired SRJ")
const routedTraces = solver.getOutputSimplifiedPcbTraces()
const drcInput = {
  inputSrj,
  srjWithPointPairs: solver.srjWithPointPairs,
  routedTraces,
}
const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
const blindErrors = evaluateRelaxedDrc({
  ...drcInput,
  inputSrj: { ...inputSrj, allowBlindAndBuriedVias: true },
  srjWithPointPairs: {
    ...solver.srjWithPointPairs,
    allowBlindAndBuriedVias: true,
  },
}).errors
const blindErrorIds = new Set(
  blindErrors
    .filter((error) => error.type === "pcb_trace_error")
    .map((error) => error.pcb_trace_error_id),
)
const throughViaContacts = errors.filter(
  (error) =>
    error.type === "pcb_trace_error" &&
    error.message.includes("overlaps with pcb_via") &&
    error.message.includes("accidental contact") &&
    !blindErrorIds.has(error.pcb_trace_error_id),
)
const indexed = new AutoroutingDrcEngine(
  solver.srjWithPointPairs as RepairSimpleRouteJson,
).evaluate(routedTraces as RepairSimplifiedPcbTraces)
const indexedErrorIds = new Set(
  indexed.errors.map((error) => error.pcb_trace_error_id),
)
const missedContacts = throughViaContacts.filter(
  (error) => !indexedErrorIds.has(error.pcb_trace_error_id),
)
const errorsByType: Record<string, number> = {}
for (const error of errors) {
  errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1
}
const wireWidths = routedTraces.flatMap((trace) =>
  trace.route.flatMap((point) =>
    point.route_type === "wire" ? [point.width] : [],
  ),
)
if (wireWidths.length === 0) throw new Error("No routed wire widths")
const summary = {
  inputHash,
  routerVersion: AUTOROUTER_VERSION,
  solved: solver.solved,
  failed: solver.failed,
  routeHash: createHash("sha256")
    .update(JSON.stringify(routedTraces))
    .digest("hex"),
  traces: routedTraces.length,
  vias: circuitJson.filter((element) => element.type === "pcb_via").length,
  relaxedDrcCount: errors.length,
  errorsByType,
  throughViaContacts: throughViaContacts.length,
  missedThroughViaContacts: missedContacts.length,
  repair03DrcCount: indexed.errors.length,
  minimumWireWidth: wireWidths.reduce((min, width) => Math.min(min, width)),
}
writeFileSync(`${outputDirectory}/summary.json`, JSON.stringify(summary, null, 2))
writeFileSync(`${outputDirectory}/routes.json`, JSON.stringify(routedTraces))
writeFileSync(
  `${outputDirectory}/point-paired.srj.json`,
  JSON.stringify(solver.srjWithPointPairs),
)
writeFileSync(`${outputDirectory}/circuit.json`, JSON.stringify(circuitJson))
writeFileSync(`${outputDirectory}/drc-errors.json`, JSON.stringify(errors, null, 2))
writeFileSync(
  `${outputDirectory}/through-via-contacts.json`,
  JSON.stringify({ throughViaContacts, missedContacts }, null, 2),
)
writeFileSync(
  `${outputDirectory}/repair03-errors.json`,
  JSON.stringify(indexed.errors, null, 2),
)
writeFileSync(`${outputDirectory}/board.svg`, getBugReportSnapshotSvg(drcInput))
writeFileSync(
  `${outputDirectory}/timing.json`,
  JSON.stringify({ durationMs, platform: process.platform, bun: Bun.version }),
)
console.log("GAMEBOY_RESULT", JSON.stringify({ ...summary, durationMs }))
if (errors.length !== 0 || throughViaContacts.length !== 0) {
  throw new Error("Completed routing has reference DRC errors or through-via contacts")
}

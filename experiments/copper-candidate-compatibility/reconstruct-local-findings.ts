import { readFileSync, writeFileSync } from "node:fs"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

const directory = process.argv[2]
if (!directory) throw new Error("A captured local result directory is required")
const original = JSON.parse(readFileSync(`${directory}/original-input.json`, "utf8"))
const traces = JSON.parse(readFileSync(`${directory}/raw-traces.json`, "utf8"))
const expected = JSON.parse(readFileSync(`${directory}/library-errors.json`, "utf8"))
const reference = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: original, routedTraces: traces, includeBoardClearance: true, drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance, includeTraceContinuity: true, includeTypedTraceClearance: true } })
const observed = await runAllRoutingChecks(structuredClone(reference.circuitJson))
const normalize = (errors: Record<string, unknown>[]): string => JSON.stringify(errors.map((error) => Object.fromEntries(Object.entries(error).filter(([key]) => !key.endsWith("_error_id")))))
if (normalize(observed) !== normalize(expected)) throw new Error("Original-context reconstruction does not match the complete saved library findings")
writeFileSync(`${directory}/circuit-json.json`, JSON.stringify(reference.circuitJson))
writeFileSync(`${directory}/reconstruction-provenance.json`, JSON.stringify({ note: "Reconstruction uses original connection context explicitly. Every saved library error field except generated per-error IDs matches exactly. This is not claimed to reproduce the unavailable Pipeline9 point-pair context.", allSavedLibraryErrorsMatched: true, observedReferenceErrorCount: reference.errors.length }))
console.log(JSON.stringify({ directory, allSavedLibraryErrorsMatched: true, libraryFindingCount: observed.length }))

import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [originalArg, preparedCasesArg] = process.argv.slice(2)
if (!originalArg || !preparedCasesArg) throw new Error("Usage: calibrate-assessment.tsx ORIGINAL_EXPERIMENT_DIR PREPARED_CASES_DIR")
const original = resolve(originalArg), cases = resolve(preparedCasesArg)
const { RootCircuit } = await import("tscircuit")
const { NativeFullBoard } = await import(pathToFileURL(join(original, "native-full-board.tsx")).href)
const { createPlaneTestSource } = await import(pathToFileURL(join(original, "plane-test-source.ts")).href)
const { arePortsConnected } = await import(pathToFileURL(join(original, "connectivity.ts")).href)
const { findFloatingCopper } = await import(pathToFileURL(join(cases, "find-floating-copper-assessment.mjs")).href)
const rows: any[] = []
for (const [name, outlines, expected] of [
  ["separate-islands", [[{ x: -6, y: -3 }, { x: -1, y: -3 }, { x: -1, y: 3 }, { x: -6, y: 3 }], [{ x: 1, y: -3 }, { x: 6, y: -3 }, { x: 6, y: 3 }, { x: 1, y: 3 }]], false],
  ["actual-copper-bridge", [[{ x: -6, y: -3 }, { x: 6, y: -3 }, { x: 6, y: 3 }, { x: -6, y: 3 }]], true],
] as const) {
  const circuit = new RootCircuit({ platform: { routingDisabled: true, localCacheEngine: undefined } })
  circuit.add(<NativeFullBoard source={createPlaneTestSource(outlines, "top")} geometryOnly />)
  await circuit.renderUntilSettled()
  const json = circuit.getCircuitJson()
  assert.equal(json.filter(element => element.type === "pcb_trace" || element.type === "pcb_via").length, 0)
  const pours = json.filter(element => element.type === "pcb_copper_pour")
  assert(pours.length > 0, "Calibration must evaluate actual generated copper")
  const ports = new Map(json.filter(element => element.type === "pcb_port").map(port => [port.source_port_id, port]))
  const groups = findFloatingCopper(json).copperConnectedPointGroups
  const actual = arePortsConnected([...ports.keys()], [], ports, [], groups)
  assert.equal(actual, expected, name)
  rows.push({ name, expected, actual, physicalPours: pours.length, terminals: ports.size, groups })
}
const manifest = process.env.FULL_BOARD_RUNTIME_MANIFEST
if (!manifest) throw new Error("Explicit runtime identity manifest required")
const result = { calibrationOnly: true, noRouting: true, authenticCalibrationSource: join(original, "pour-connectivity.test.tsx"), runtime: JSON.parse(readFileSync(manifest, "utf8")), rows }
writeFileSync(join(cases, "assessment-calibration.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ assessmentCalibrationPassed: true, rows }))

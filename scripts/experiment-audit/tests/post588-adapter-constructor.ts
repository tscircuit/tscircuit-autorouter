import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// Constructor-only adapter fixture. No solve/step/output method is invoked.
const config = JSON.parse(readFileSync(process.env.EXPERIMENT_AUDIT_CONFIG!, "utf8"))
const module = await import(pathToFileURL(resolve("scripts/benchmark/experiment-audit-adapter.ts")).href)
const task: any = { datasetName: "synthetic-controller", sampleNumber: 1,
  scenario: { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, obstacles: [],
    connections: [{ name: "synthetic", pointsToConnect: [
      { x: -0.5, y: 0, layer: "top" }, { x: 0.5, y: 0, layer: "top" },
    ] }] } }
const solver = module.createExperimentAuditSolver(module.getExperimentAuditConstructor(), task, {})
const evidence = module.getExperimentAuditEvidence(solver, task)
assert.equal(evidence.actualConstructorName, config.solverName)
assert.equal(evidence.actualCacheProviderState, "disabled")
assert.equal(evidence.inputMutated, false)
assert.deepEqual(evidence.options, config.options)
assert.equal(evidence.phaseCheckpoint.installed, true)
assert.equal(evidence.phaseCheckpoint.solveEntered, false)
assert.equal(evidence.phaseCheckpoint.solveFinished, false)
assert.equal(solver.iterations, 0)
const rows = readFileSync(resolve(process.env.EXPERIMENT_AUDIT_OUTPUT!, "phase-checkpoints.jsonl"), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line))
assert.deepEqual(rows.map((row) => row.event), ["pipeline_constructor_enter", "pipeline_constructor_exit"])
assert.deepEqual(rows.at(-1).observedRequestedOptions, config.options)
assert.equal(rows.at(-1).actualCacheProviderState, "disabled")
assert.equal(rows.at(-1).observedConstructorName, config.solverName)
let getterTouched = false
const path = config.evidencePaths[0]
Object.defineProperty(solver, path.split(".")[0], { get() { getterTouched = true; throw new Error("Getter must not execute") } })
assert.equal(module.getExperimentAuditEvidence(solver, task).evidence[path], null)
assert.equal(getterTouched, false)
console.log(JSON.stringify({ status: "PASS", fixture: "CONSTRUCTOR_ONLY_NO_SOLVE",
  actualConstructor: config.solverName, requestedOptionsObservedOnActualInstance: true,
  getterNotInvoked: true, stageActivationOrAlgorithmWorkClaim: false }))

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as selected from "./selected-autorouter.mjs"
import { createSolverForTask } from "./scripts/benchmark/benchmark-run-task.ts"
import { loadScenarios } from "./scripts/benchmark/scenarios.ts"

const entry = JSON.parse(readFileSync(new URL("./selected-entry.json", import.meta.url), "utf8"))
if (createHash("sha256").update(readFileSync(entry.entry)).digest("hex") !== entry.sha256) throw new Error("Selected AR entry differs")
if (createHash("sha256").update(readFileSync(entry.sourceEntry)).digest("hex") !== entry.sourceSha256) throw new Error("Selected P9 source differs")
if (selected.AutoroutingPipelineSolver !== selected.AutoroutingPipelineSolver9_PreloadedTraceGraph) throw new Error("P9 aliases differ")
if (selected.AUTOROUTER_VERSION !== "0.0.1112") throw new Error("Expected AR1112 exports")
const scenarios = await loadScenarios("srj18")
if (scenarios.length !== 16) throw new Error("Dataset18 scenario count changed")
const fixtures = scenarios.map(([name, scenario]) => ({ name,
  sha256: createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
  effort: scenario.effort ?? 1 }))
if (fixtures.some(item => item.effort !== 1)) throw new Error("Dataset18 native effort differs from the frozen1x cases")
const [scenarioName, scenario] = scenarios[0]
const solver = createSolverForTask({ datasetName: "srj18", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  threads: 1, scenarioName, sampleNumber: 1, scenario: structuredClone(scenario) })
if (!(solver instanceof selected.AutoroutingPipelineSolver9_PreloadedTraceGraph)) throw new Error("Benchmark constructor bypassed the selected published entry")
if (typeof solver.stepAsync !== "undefined" || typeof solver.solveAsync !== "function" || typeof solver.step !== "function") throw new Error("Expected Pipeline9 inline benchmark API")
// The ordinary threads=1 benchmark calls solveAsync(undefined). Prove that
// path delegates to this instance's inline solve without stepping the fixture.
let inlineSolveCalls = 0
const originalSolve = solver.solve
solver.solve = () => { inlineSolveCalls++ }
try { await solver.solveAsync() } finally { solver.solve = originalSolve }
if (inlineSolveCalls !== 1 || solver.iterations !== 0) throw new Error("Thread1 benchmark did not stay inline")
console.log("DATASET18_ENTRY_IDENTITY " + JSON.stringify({ ...entry, fixtures,
  exportCount: Object.keys(selected).length, exactSelectedConstructor: true, inlineSynchronous: true, inlineSolveCalls,
  solverStepped: false, selectedSolver: "AutoroutingPipelineSolver9_PreloadedTraceGraph" }))

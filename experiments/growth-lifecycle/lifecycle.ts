import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { installSetupLifecycleObservers } from "./setup-diagnostics"

type Task = { repo: string; sourceSha: string; dataset: string; sample: number; effort: number; inputPath: string; inputSha256: string; resultPath: string; progressPath: string; detailsPath: string }

const task = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Task
const load = async (path: string): Promise<any> => import(pathToFileURL(resolve(task.repo, path)).href)
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const progress = (phase: string): void => writeFileSync(task.progressPath, JSON.stringify({ phase }))

progress("loading")
const instrumentedPackageEntry = realpathSync(Bun.resolveSync("@tscircuit/high-density-a01", resolve(task.repo, "package.json")))
const portfolioPackageEntry = realpathSync(Bun.resolveSync("@tscircuit/high-density-a01", resolve(task.repo, "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts")))
if (instrumentedPackageEntry !== portfolioPackageEntry) throw new Error("Lifecycle observer and Portfolio resolve different HD-A01 module identities")
const hd = await import(pathToFileURL(instrumentedPackageEntry).href)
const finishLifecycle = installSetupLifecycleObservers(hd)

// Install the two wrappers before any Pipeline9 module can capture the classes.
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
const { evaluateRelaxedDrc } = await load("lib/testing/evaluate-relaxed-drc.ts")
const { runTraceLinting } = await load("lib/testing/runTraceLinting.ts")
const encoded = readFileSync(task.inputPath)
if (createHash("sha256").update(new Uint8Array(encoded)).digest("hex") !== task.inputSha256) throw new Error("Prepared diagnostic input changed")
const input = JSON.parse(encoded.toString("utf8"))
progress("constructor")
const solver = new Pipeline(input, { effort: task.effort })
progress("solve")
await solver.solveAsync()
if (!solver.solved || solver.failed || solver.error) throw new Error(`Instrumented baseline did not solve: ${solver.error}`)
progress("validation")
const traces = solver.getOutputSimplifiedPcbTraces()
const output = solver.getOutputSimpleRouteJson()
const relaxed = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs ?? input, routedTraces: traces })
const sourceOptions: Record<string, number> = {}
const traceClearance = input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin
if (traceClearance !== undefined) sourceOptions.traceClearance = traceClearance
if (input.minViaHoleEdgeToViaHoleEdgeClearance !== undefined) sourceOptions.viaClearance = input.minViaHoleEdgeToViaHoleEdgeClearance
const boardAware = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs ?? input, routedTraces: traces, includeBoardClearance: true, drcOptions: sourceOptions })
const linter = runTraceLinting(output)
const lint: Record<string, number> = {}
for (const issue of linter.getOutput()) lint[issue.type] = (lint[issue.type] ?? 0) + 1
progress("hash")
const hashes = { tracesSha256: sha(traces), outputSha256: sha(output), relaxedErrorsSha256: sha(relaxed.errors), boardAwareErrorsSha256: sha(boardAware.errors), inputAfterSha256: sha(input) }

// Summarize only scalar metadata after all full output hashes. No solver references are retained.
const { details, families } = finishLifecycle()
writeFileSync(task.detailsPath, JSON.stringify(details))
writeFileSync(task.resultPath, JSON.stringify({
  status: "solved", scope: "INSTRUMENTED_BASELINE_LIFECYCLE_ONLY_NO_TIMING_OR_RSS_CLAIM", sourceSha: task.sourceSha, bunVersion: Bun.version, dataset: task.dataset, sample: task.sample, inputSha256: task.inputSha256, cacheMode: "production-default", constructorOptions: { effort: task.effort }, cacheProviderSpecified: false,
  hashes, iterations: solver.iterations, drcErrorCount: relaxed.errors.length, boardAwareDrcErrorCount: boardAware.errors.length, traceLintIssueCounts: lint, traceCount: traces.length,
  diagnostics: { instrumentedPackageEntry, portfolioPackageEntry, sameCanonicalPackageEntry: true, families, detailsSha256: sha(details), detailCount: details.length, scope: "Workspace buffer bytes are bounded reachable unique ArrayBuffer lengths at setup, not RSS or peak heap. JS array lengths and CSR edges describe work only; local transient neighbor arrays cannot be measured after setup. Records contain snapshots of scalar metadata only, with WeakMap keys and no retained solver/array/buffer references. No-step counts mean no observed public step call after setup; already-solved or failed-at-setup cases are separate. These counts do not establish liveness or peak-memory savings." },
}))
progress("complete")

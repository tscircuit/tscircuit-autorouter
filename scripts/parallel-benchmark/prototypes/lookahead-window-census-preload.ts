/** Isolated operation census only. Run against the source SHA recorded in the accompanying evidence; production modules are never edited. */
import { plugin } from "bun"
import { readFileSync } from "node:fs"
const capacity = Number(process.env.PARALLEL_PATH_WINDOW)
if (![8,16,32,64].includes(capacity)) throw new Error("unsupported isolated window")
function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw new Error(`missing or duplicated source seam ${from}`)
  return source.replace(from, to)
}
plugin({ name: `isolated-native-lookahead-window-${capacity}`, setup(build) {
  build.onLoad({ filter: /(?:ParallelPathLookaheadCoordinator\.ts|createParallelPathLookaheadEligibility\.ts|Pipeline9LocalWorkerPool\.ts|parallel-path-lookahead-srj18-phase-parity\.test\.ts|parallel-path-lookahead-window-capacity\.test\.ts)$/ }, (args) => {
    let contents = readFileSync(args.path, "utf8")
    if (args.path.endsWith("createParallelPathLookaheadEligibility.ts")) {
      contents = replaceOnce(contents, "const nativeLookaheadWindowCapacity = 16", `const nativeLookaheadWindowCapacity = ${capacity}`)
    } else if (args.path.endsWith("ParallelPathLookaheadCoordinator.ts")) {
      contents = replaceOnce(contents, "windowCapacity > 16", `windowCapacity > ${capacity}`)
      contents = replaceOnce(contents, "scopeCaptureDeclines: 0,", "scopeCaptureDeclines: 0, censusMaximumRetainedQueryRecords: 0, censusMaximumRetainedResults: 0,")
      contents = replaceOnce(contents, "if (pending) pending.ready = result", `if (pending) pending.ready = result
        let retainedQueries = 0, retainedResults = 0
        for (const entry of this.pending.values()) if (entry.ready) {
          retainedQueries += entry.ready.nativeQueryCount
          retainedResults++
        }
        this.stats.censusMaximumRetainedQueryRecords = Math.max(this.stats.censusMaximumRetainedQueryRecords, retainedQueries)
        this.stats.censusMaximumRetainedResults = Math.max(this.stats.censusMaximumRetainedResults, retainedResults)`)
    } else if (args.path.endsWith("Pipeline9LocalWorkerPool.ts")) {
      contents = replaceOnce(contents, "readonly stats = { tasksStarted: 0, tasksCompleted: 0, maxActiveWorkers: 0,", `readonly stats = { tasksStarted: 0, tasksCompleted: 0, maxActiveWorkers: 0,
        censusStartsByActive: [0,0,0,0,0], censusCompletionsByActive: [0,0,0,0,0],
        censusJobsByWorker: [0,0,0,0], censusStepsByWorker: [0,0,0,0], censusQueriesByWorker: [0,0,0,0],`)
      contents = replaceOnce(contents, "this.stats.tasksStarted++", `this.stats.tasksStarted++
      if (task.job.kind === "simplifyPathLookahead") {
        const active = this.workers.filter((candidate) => candidate.task !== null).length
        this.stats.censusStartsByActive[active]++
        this.stats.censusJobsByWorker[this.workers.indexOf(slot)]++
      }`)
      contents = replaceOnce(contents, `if (task.job.kind === "highDensityNode" || task.job.kind === "highDensityNodeBatch") this.cancelOwnerCandidates(task.taskId)`, `if (response.ok && task.job.kind === "simplifyPathLookahead") {
        const active = this.workers.filter((candidate) => candidate.task !== null).length
        this.stats.censusCompletionsByActive[active]++
        const workerIndex = this.workers.indexOf(slot)
        this.stats.censusStepsByWorker[workerIndex] += response.result.nativeSteps
        this.stats.censusQueriesByWorker[workerIndex] += response.result.nativeQueryCount
      }
      if (task.job.kind === "highDensityNode" || task.job.kind === "highDensityNodeBatch") this.cancelOwnerCandidates(task.taskId)`)
    } else if (args.path.endsWith("parallel-path-lookahead-srj18-phase-parity.test.ts")) {
      contents = replaceOnce(contents, "expect(parallel.stats.lookaheadMaximumLookahead).toBe(16)", `expect(parallel.stats.lookaheadMaximumLookahead).toBe(${capacity})`)
      contents = replaceOnce(contents, "const native = new MultiSimplifiedPathSolver(config)", `const poolBefore = structuredClone(pool.stats)
      const native = new MultiSimplifiedPathSolver(config)`)
      contents = replaceOnce(contents, "stats: { ...parallel.stats } })", `stats: { ...parallel.stats }, workerCensus: {
          maximumActiveWorkers: pool.stats.maxActiveWorkers,
          tasksStarted: pool.stats.tasksStarted - poolBefore.tasksStarted,
          tasksCompleted: pool.stats.tasksCompleted - poolBefore.tasksCompleted,
          startsByActiveWorkerCount: pool.stats.censusStartsByActive.map((value, index) => value - poolBefore.censusStartsByActive[index]),
          completionsByActiveWorkerCount: pool.stats.censusCompletionsByActive.map((value, index) => value - poolBefore.censusCompletionsByActive[index]),
          jobsByWorker: pool.stats.censusJobsByWorker.map((value, index) => value - poolBefore.censusJobsByWorker[index]),
          nativeStepsByWorker: pool.stats.censusStepsByWorker.map((value, index) => value - poolBefore.censusStepsByWorker[index]),
          nativeQueriesByWorker: pool.stats.censusQueriesByWorker.map((value, index) => value - poolBefore.censusQueriesByWorker[index]),
        } })`)
      contents = replaceOnce(contents, "expect(pool.stats.tasksCompleted).toBe(routes)", `expect(pool.stats.tasksCompleted).toBe(routes)
    expect(pool.workerCount).toBe(4)
    expect(pool.stats.censusJobsByWorker.reduce((sum, value) => sum + value, 0)).toBe(routes)
    expect(pool.stats.censusStepsByWorker.reduce((sum, value) => sum + value, 0)).toBe(counts.reduce((sum, row) => sum + row.stats.lookaheadSpeculativeNativeSteps, 0))`)
    }
    if (args.path.endsWith("parallel-path-lookahead-window-capacity.test.ts")) {
      const routes = Math.max(24, capacity * 2)
      contents = replaceOnce(contents, "index < 24", `index < ${routes}`)
      contents = contents.replaceAll("toBe(16)", `toBe(${capacity})`)
      contents = replaceOnce(contents, "length: 16", `length: ${capacity}`)
      contents = replaceOnce(contents, "[...indexes, 16]", `[...indexes, ${capacity}]`)
      contents = contents.replaceAll("HdRoutes[15]", `HdRoutes[${capacity - 1}]`)
      contents = contents.replaceAll("toBe(24)", `toBe(${routes})`)
    }
    return { contents, loader: "ts" }
  })
}})

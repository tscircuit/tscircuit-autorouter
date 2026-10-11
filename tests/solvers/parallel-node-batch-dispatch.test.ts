import { expect, test } from "bun:test"
import { getParallelNodeJobDispatches, type ParallelWeightedNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelNodeJobBatching"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import { createParallelNodeBatchFixture } from "tests/fixtures/parallel-node-batch-fixtures"

test("node batches preserve every single child output and enforce heavy, weight, and 64-entry boundaries", (): void => {
  const fixture = createParallelNodeBatchFixture()
  for (const jobs of [fixture.forceJobs, fixture.repairJobs]) {
    const entries: ParallelWeightedNodeJob[] = jobs.map((job, entryIndex) => ({
      job, entryIndex, weight: entryIndex < 4 ? 1000 : 1,
    }))
    const dispatches = getParallelNodeJobDispatches(entries, 4)
    expect(dispatches.filter((dispatch) => dispatch.kind === "single")).toHaveLength(4)
    expect(dispatches.filter((dispatch) => dispatch.kind === "batch").map((dispatch) => {
      if (dispatch.kind !== "batch") throw new Error("Expected node batch")
      return dispatch.job.jobs.length
    })).toEqual([64, 64, 2])
    const baselineInput = structuredClone(jobs)
    const expected = jobs.map((job) => executeParallelStageJob(structuredClone(job)))
    const actual = []
    for (const dispatch of dispatches) {
      if (dispatch.kind === "single") {
        actual.push({ entryIndex: dispatch.entry.entryIndex, result: executeParallelStageJob(dispatch.entry.job) })
      } else {
        const result = executeParallelStageJob(dispatch.job)
        if (result.kind !== "forceImproveNodeBatch" && result.kind !== "repairNodeBatch") {
          throw new Error("Expected batch worker result")
        }
        actual.push(...result.results)
      }
    }
    expect(actual.map((entry) => entry.entryIndex)).toEqual(entries.map((entry) => entry.entryIndex))
    expect(actual.map((entry) => entry.result)).toEqual(expected)
    expect(jobs).toEqual(baselineInput)
    const smallEntries = entries.slice(4, 36)
    const smallDispatches = getParallelNodeJobDispatches(smallEntries, 4)
    expect(smallDispatches.filter((dispatch) => dispatch.kind === "batch").map((dispatch) => {
      if (dispatch.kind !== "batch") throw new Error("Expected bounded node batch")
      return dispatch.job.jobs.length
    })).toEqual(new Array(16).fill(2))
    expect(getParallelNodeJobDispatches([], 1)).toEqual([])
    expect(() => getParallelNodeJobDispatches(entries, 5)).toThrow("workerCount")
    expect(() => getParallelNodeJobDispatches([{ ...entries[0]!, weight: NaN }])).toThrow("weights")
  }
})

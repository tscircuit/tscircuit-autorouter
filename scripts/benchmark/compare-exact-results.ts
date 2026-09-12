#!/usr/bin/env bun

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { BenchmarkReport, WorkerResult } from "./benchmark-types"

type RunSummary = {
  meanTimeMs: number | null
  p50TimeMs: number | null
  p95TimeMs: number | null
}

function comparableResult(result: WorkerResult): object {
  const { phaseTimeMs, tinyHypergraph, ...routingMetrics } = result.routingMetrics ?? {}
  const { backend, timeMs, ...hypergraphMetrics } = tinyHypergraph ?? {}
  return {
    solverName: result.solverName,
    scenarioName: result.scenarioName,
    didSolve: result.didSolve,
    didTimeout: result.didTimeout,
    relaxedDrcPassed: result.relaxedDrcPassed,
    viaCount: result.viaCount,
    drcErrorCount: result.drcErrorCount,
    drcErrorTypes: result.drcErrorTypes,
    drcErrorMessages: result.drcErrorMessages,
    errorPhaseName: result.errorPhaseName,
    errorSolverName: result.errorSolverName,
    error: result.error,
    routingMetrics,
    hypergraphMetrics,
  }
}

function summarize(report: BenchmarkReport): RunSummary {
  const successful = report.tests.filter((result) => result.didSolve)
  return {
    meanTimeMs: successful.length === 0 ? null
      : successful.reduce((sum, result) => sum + result.elapsedTimeMs, 0) / successful.length,
    p50TimeMs: report.summary[0].p50TimeMs,
    p95TimeMs: report.summary[0].p95TimeMs,
  }
}

async function main(): Promise<void> {
  const [referenceDirectory, currentDirectory, ...extra] = process.argv.slice(2)
  assert(referenceDirectory && currentDirectory && extra.length === 0,
    "Usage: bun scripts/benchmark/compare-exact-results.ts <reference-directory> <current-directory> (each contains result.json and traces/<sample>.json)")
  const [reference, current] = await Promise.all(
    [referenceDirectory, currentDirectory].map(async (directory): Promise<BenchmarkReport> =>
      JSON.parse(await readFile(resolve(directory, "result.json"), "utf8"))),
  )
  for (const key of ["version", "datasetName", "scenarioCount", "effortLabel"] as const) {
    assert.deepStrictEqual(current[key], reference[key], `Benchmark ${key} differs`)
  }
  assert.equal(reference.summary.length, 1, "Trace capture requires one solver per run")
  assert.equal(current.summary.length, 1, "Trace capture requires one solver per run")
  assert(reference.tests.length > 0, "Reference contains no samples")
  assert.equal(current.tests.length, reference.tests.length, "Sample counts differ")
  const expectedBySample = new Map(reference.tests.map((result) => [result.sampleNumber, result]))
  const actualBySample = new Map(current.tests.map((result) => [result.sampleNumber, result]))
  assert.equal(expectedBySample.size, reference.tests.length, "Duplicate reference sample")
  assert.equal(actualBySample.size, current.tests.length, "Duplicate current sample")

  const byteExactSamples: number[] = []
  const boards: object[] = []
  for (const [sample, expected] of expectedBySample) {
    const actual = actualBySample.get(sample)
    assert(actual, `Missing sample ${sample}`)
    assert.deepStrictEqual(comparableResult(actual), comparableResult(expected),
      `Sample ${sample}: status, diagnostics, or routing work differs`)
    if (expected.didSolve) {
      const [expectedBytes, actualBytes] = await Promise.all(
        [referenceDirectory, currentDirectory].map((directory): Promise<Buffer> =>
          readFile(resolve(directory, "traces", `${sample}.json`))),
      )
      const expectedView = new Uint8Array(expectedBytes.buffer, expectedBytes.byteOffset, expectedBytes.byteLength)
      assert(actualBytes.equals(expectedView), `Sample ${sample}: route bytes differ`)
      byteExactSamples.push(sample)
    }
    boards.push({ sample, solved: actual.didSolve,
      referenceTimeMs: expected.elapsedTimeMs, currentTimeMs: actual.elapsedTimeMs,
      speedup: actual.elapsedTimeMs > 0 ? expected.elapsedTimeMs / actual.elapsedTimeMs : null })
  }
  console.log(JSON.stringify({
    dataset: current.datasetName,
    matchedSamples: expectedBySample.size,
    byteExactSamples,
    reference: summarize(reference),
    current: summarize(current),
    boards,
  }, null, 2))
}

await main()

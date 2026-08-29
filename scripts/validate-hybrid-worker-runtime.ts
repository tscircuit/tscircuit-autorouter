import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { negotiateBoundaryContracts } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/boundary-contract-negotiator"
import { buildHybridWorkerBoardContext, buildRegionJob } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-worker-messages"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { runParallelHybridTransactionalEngine } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/parallel-hybrid-transactional-engine"
import type { ParallelHybridEngineConfiguration } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/parallel-hybrid-transactional-engine"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingCoreRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/rust-core-runtime"
import { runSerialHybridTransactionalEngine } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/serial-hybrid-transactional-engine"
import { HybridRoutingWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/worker-pool"
import type { RegionJob } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/worker-protocol"
import { createHybridRoutingTestProblem } from "tests/hybrid-transactional-router/fixtures"

const runtimeModulePath = process.argv[2]
if (!runtimeModulePath) {
  throw new Error(
    "usage: bun scripts/validate-hybrid-worker-runtime.ts <native-or-wasm-module-path>",
  )
}
const workerEntryPath = resolve(
  "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/hybrid-routing-worker.ts",
)
const problem = createHybridRoutingTestProblem()
const topologyPlan = planGlobalTopology({
  problem,
  maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
})
const regionGraph = new DynamicRegionGraph({
  problem,
  topologyPlan,
  maximumRegionCount: 128,
  maximumMutationCount: 128,
  maximumMergeRegionCount: 8,
}).getSnapshot()
const boundaryContracts = negotiateBoundaryContracts({
  problem,
  topologyPlan,
  regionGraph,
})
const copperSnapshot = new TransactionalCopperStore({
  problem,
  maximumTransactionHistory: 32,
}).getSnapshot()
const jobs = topologyPlan.routeObjectPlans.slice(0, 2).map((routePlan) => {
  const region = regionGraph.regions.find((candidate) =>
    candidate.routeObjectIds.includes(routePlan.routeObjectId),
  )
  assert(region, `missing region for ${routePlan.routeObjectId}`)
  return buildRegionJob({
    problem,
    routePlan,
    region,
    boundaryContracts,
    copperSnapshot,
    maximumExpansions: 250_000,
    maximumActivationRings: 4,
    deterministicSeed: 17,
  })
})
assert.equal(jobs.length, 2)

const pool = new HybridRoutingWorkerPool({
  workerEntryPath,
  runtimeTarget: "native",
  runtimeModulePath,
  maximumWorkerCount: 2,
  maximumQueueLength: 8,
})
await pool.initialize(
  buildHybridWorkerBoardContext({
    problem,
    copperSnapshot,
    contextId: "worker-validation-context",
    boardContextVersion: 0,
  }),
)
const parallelResults = await Promise.all(jobs.map((job) => pool.submit(job)))
if (process.env.HYBRID_WORKER_DEBUG === "1") {
  console.log(JSON.stringify(parallelResults))
}
assert(
  parallelResults.every((result) => result.status === "completed"),
  "real Rust jobs must complete in both isolated workers",
)
assert.equal(
  new Set(
    parallelResults.flatMap((result) =>
      result.status === "completed" ? [result.response.workerId] : [],
    ),
  ).size,
  2,
)

const staleResult = await pool.submit(
  cloneJob({ job: jobs[0]!, suffix: "stale", copperVersion: 1 }),
)
assert.equal(staleResult.status, "failed")
if (staleResult.status === "failed") {
  assert.equal(staleResult.response.code, "stale_copper_version")
}

const cancellableJob = cloneJob({ job: jobs[0]!, suffix: "cancel" })
const cancelledResultPromise = pool.submit(cancellableJob)
assert.equal(await pool.cancel(cancellableJob.jobId), true)
assert.equal((await cancelledResultPromise).status, "cancelled")
const replacementResult = await pool.submit(
  cloneJob({ job: jobs[0]!, suffix: "after-restart" }),
)
assert.equal(replacementResult.status, "completed")
await pool.close()

const singleWorkerResult = await runParallelHybridTransactionalEngine({
  problem,
  configuration: createEngineConfiguration(1),
})
const fourWorkerResult = await runParallelHybridTransactionalEngine({
  problem,
  configuration: createEngineConfiguration(4),
})
const repeatedFourWorkerResult = await runParallelHybridTransactionalEngine({
  problem,
  configuration: createEngineConfiguration(4),
})
const runtimeModule: unknown = createRequire(import.meta.url)(runtimeModulePath)
assert(
  isRecord(runtimeModule) &&
    typeof runtimeModule.executeHybridRoutingCore === "function",
  "native runtime module must export executeHybridRoutingCore",
)
const nativeExecutor = runtimeModule.executeHybridRoutingCore
const serialResult = await runSerialHybridTransactionalEngine({
  problem,
  configuration: {
    runtime: createHybridRoutingCoreRuntime({
      target: "native",
      executeJson(inputJson) {
        const output: unknown = nativeExecutor(inputJson)
        if (typeof output !== "string") {
          throw new Error("native core must return JSON text")
        }
        return output
      },
    }),
    deterministicSeed: 17,
    maximumSearchExpansions: 250_000,
    maximumActivationRings: 4,
    maximumTransactionHistory: 64,
    maximumDemandCellCount: 100_000,
    maximumRegionCount: 128,
    maximumRegionMutationCount: 128,
    maximumMergeRegionCount: 8,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
    maximumWaveMemoryBytes: 128 * 1024 * 1024,
    maximumFinalViolationCount: 64,
  },
})
assert.equal(
  singleWorkerResult.status,
  "routed",
  singleWorkerResult.status === "routed"
    ? undefined
    : JSON.stringify({
        message: singleWorkerResult.message,
        attempts: singleWorkerResult.artifacts.attempts,
      }),
)
assert.equal(
  fourWorkerResult.status,
  "routed",
  fourWorkerResult.status === "routed"
    ? undefined
    : JSON.stringify({
        message: fourWorkerResult.message,
        attempts: fourWorkerResult.artifacts.attempts,
      }),
)
assert.equal(
  repeatedFourWorkerResult.status,
  "routed",
  repeatedFourWorkerResult.status === "routed"
    ? undefined
    : JSON.stringify({
        message: repeatedFourWorkerResult.message,
        attempts: repeatedFourWorkerResult.artifacts.attempts,
      }),
)
assert.deepEqual(
  fourWorkerResult.artifacts.copperSnapshot,
  singleWorkerResult.artifacts.copperSnapshot,
  "authoritative copper must be byte-stable across concurrency settings",
)
if (
  singleWorkerResult.status !== "routed" ||
  fourWorkerResult.status !== "routed" ||
  repeatedFourWorkerResult.status !== "routed"
) {
  throw new Error("verified routed results are required for hash comparison")
}
assert.equal(
  fourWorkerResult.verification.routeHash,
  singleWorkerResult.verification.routeHash,
  "route hash must be stable across concurrency settings",
)
assert.equal(
  repeatedFourWorkerResult.verification.routeHash,
  fourWorkerResult.verification.routeHash,
  "route hash must be stable across repeated runs",
)
assert.equal(
  serialResult.status,
  "routed",
  serialResult.status === "routed" ? undefined : serialResult.message,
)
assert.deepEqual(
  serialResult.artifacts.copperSnapshot,
  singleWorkerResult.artifacts.copperSnapshot,
  "the serial fast path must preserve authoritative route selection",
)

console.log(
  JSON.stringify({
    isolatedWorkerIds: parallelResults.flatMap((result) =>
      result.status === "completed" ? [result.response.workerId] : [],
    ),
    staleFailure: staleResult.status,
    cancellation: "cancelled",
    replacementWorker: replacementResult.status,
    deterministicCopperVersion:
      singleWorkerResult.artifacts.copperSnapshot.version,
    deterministicRouteHash: singleWorkerResult.verification.routeHash,
    serialFastPath: serialResult.status,
  }),
)

function cloneJob({
  job,
  suffix,
  copperVersion = job.copperVersion,
}: {
  job: RegionJob
  suffix: string
  copperVersion?: number
}): RegionJob {
  return Object.freeze({
    ...job,
    jobId: `${job.jobId}:${suffix}`,
    transactionId: `${job.transactionId}:${suffix}`,
    copperVersion,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createEngineConfiguration(
  maximumConcurrency: number,
): ParallelHybridEngineConfiguration {
  return Object.freeze({
    workerEntryPath,
    runtimeTarget: "native",
    runtimeModulePath,
    maximumConcurrency,
    maximumWorkerQueueLength: 32,
    deterministicSeed: 17,
    maximumSearchExpansions: 250_000,
    maximumActivationRings: 4,
    maximumTransactionHistory: 64,
    maximumDemandCellCount: 100_000,
    maximumRegionCount: 128,
    maximumRegionMutationCount: 128,
    maximumMergeRegionCount: 8,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
    maximumWaveMemoryBytes: 128 * 1024 * 1024,
    maximumFinalViolationCount: 64,
  })
}

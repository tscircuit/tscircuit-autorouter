import { createRequire } from "node:module"
import { parentPort, workerData } from "node:worker_threads"
import { executeRegionJob } from "./execute-region-job"
import { createHybridRoutingCoreRuntime } from "./rust-core-runtime"
import type { HybridRoutingCoreJsonExecutor } from "./rust-core-runtime"
import type {
  HybridWorkerBoardContext,
  HybridWorkerRequest,
  HybridWorkerResponse,
  HybridWorkerRuntimeConfiguration,
} from "./worker-protocol"
import { HYBRID_WORKER_PROTOCOL_VERSION } from "./worker-protocol"

if (!parentPort) {
  throw new Error("hybrid routing worker must run inside a worker thread")
}

const runtimeConfiguration = parseRuntimeConfiguration(workerData)
const requireModule = createRequire(import.meta.url)
const runtimeModule: unknown = requireModule(runtimeConfiguration.runtimeModulePath)
const executeJson = getRuntimeExecutor(runtimeModule)
const runtime = createHybridRoutingCoreRuntime({
  target: runtimeConfiguration.target,
  executeJson,
})
const workerParentPort = parentPort
let context: HybridWorkerBoardContext | undefined

workerParentPort.on("message", (request: HybridWorkerRequest) => {
  void handleRequest(request).catch((error) => {
    if (request.type !== "run") throw error
    const response: HybridWorkerResponse = {
      type: "job_failed",
      workerId: runtimeConfiguration.workerId,
      jobId: request.job.jobId,
      code: "runtime_failure",
      message: getErrorMessage(error),
      solveTimeMs: 0,
      cpuTimeMs: 0,
    }
    workerParentPort.postMessage(response)
  })
})

async function handleRequest(request: HybridWorkerRequest): Promise<void> {
  if (request.type === "initialize") {
    if (request.context.protocolVersion !== HYBRID_WORKER_PROTOCOL_VERSION) {
      throw new Error(
        `worker context protocol ${request.context.protocolVersion} is incompatible`,
      )
    }
    context = request.context
    const response: HybridWorkerResponse = {
      type: "initialized",
      workerId: runtimeConfiguration.workerId,
      contextId: request.context.contextId,
    }
    workerParentPort.postMessage(response)
    return
  }
  if (request.type === "shutdown") {
    workerParentPort.close()
    return
  }
  if (request.type === "apply_copper_update") {
    if (!context) {
      throw new Error("cannot update copper before worker context initialization")
    }
    if (
      request.update.baseCopperVersion !== context.copperVersion ||
      request.update.nextCopperVersion !== context.copperVersion + 1
    ) {
      throw new Error(
        `worker copper update does not advance version ${context.copperVersion} by one`,
      )
    }
    const removedIds = new Set(request.update.removedGeometryIds)
    context = Object.freeze({
      ...context,
      copperVersion: request.update.nextCopperVersion,
      geometry: Object.freeze([
        ...context.geometry.filter(
          (item) => !removedIds.has(item.geometry.geometryId),
        ),
        ...request.update.addedGeometry,
      ]),
    })
    const response: HybridWorkerResponse = {
      type: "copper_updated",
      workerId: runtimeConfiguration.workerId,
      copperVersion: context.copperVersion,
    }
    workerParentPort.postMessage(response)
    return
  }
  const solveStart = performance.now()
  const cpuStart = process.cpuUsage()
  if (!context) {
    postJobFailure({
      jobId: request.job.jobId,
      code: "context_not_initialized",
      message: "worker board context has not been initialized",
      solveStart,
      cpuStart,
    })
    return
  }
  if (request.job.boardContextVersion !== context.boardContextVersion) {
    postJobFailure({
      jobId: request.job.jobId,
      code: "stale_board_context",
      message: `job board context ${request.job.boardContextVersion} differs from worker context ${context.boardContextVersion}`,
      solveStart,
      cpuStart,
    })
    return
  }
  if (request.job.copperVersion !== context.copperVersion) {
    postJobFailure({
      jobId: request.job.jobId,
      code: "stale_copper_version",
      message: `job copper version ${request.job.copperVersion} differs from worker version ${context.copperVersion}`,
      solveStart,
      cpuStart,
    })
    return
  }
  const result = await executeRegionJob({
    context,
    job: request.job,
    runtime,
  })
  const cpuTimeMs = getCpuElapsedMs(cpuStart)
  const solveTimeMs = performance.now() - solveStart
  if (result.status === "failed") {
    postJobFailure({
      jobId: request.job.jobId,
      code: result.code,
      message: result.message,
      solveStart,
      cpuStart,
      measuredSolveTimeMs: solveTimeMs,
      measuredCpuTimeMs: cpuTimeMs,
    })
    return
  }
  const response: HybridWorkerResponse = {
    type: "result",
    workerId: runtimeConfiguration.workerId,
    jobId: request.job.jobId,
    transactionDelta: result.transactionDelta,
    solveTimeMs,
    cpuTimeMs,
    receivedBytes: getSerializedBytes(request.job),
    returnedBytes: getSerializedBytes(result.transactionDelta),
  }
  workerParentPort.postMessage(response)
}

function postJobFailure({
  jobId,
  code,
  message,
  solveStart,
  cpuStart,
  measuredSolveTimeMs,
  measuredCpuTimeMs,
}: {
  jobId: string
  code: Extract<HybridWorkerResponse, { type: "job_failed" }>["code"]
  message: string
  solveStart: number
  cpuStart: NodeJS.CpuUsage
  measuredSolveTimeMs?: number
  measuredCpuTimeMs?: number
}): void {
  const response: HybridWorkerResponse = {
    type: "job_failed",
    workerId: runtimeConfiguration.workerId,
    jobId,
    code,
    message,
    solveTimeMs: measuredSolveTimeMs ?? performance.now() - solveStart,
    cpuTimeMs: measuredCpuTimeMs ?? getCpuElapsedMs(cpuStart),
  }
  workerParentPort.postMessage(response)
}

function getCpuElapsedMs(start: NodeJS.CpuUsage): number {
  const elapsed = process.cpuUsage(start)
  return (elapsed.user + elapsed.system) / 1000
}

function parseRuntimeConfiguration(
  value: unknown,
): HybridWorkerRuntimeConfiguration {
  if (
    !isRecord(value) ||
    typeof value.workerId !== "string" ||
    (value.target !== "native" && value.target !== "wasm") ||
    typeof value.runtimeModulePath !== "string"
  ) {
    throw new Error("hybrid worker received invalid runtime configuration")
  }
  return Object.freeze({
    workerId: value.workerId,
    target: value.target,
    runtimeModulePath: value.runtimeModulePath,
  })
}

function getRuntimeExecutor(value: unknown): HybridRoutingCoreJsonExecutor {
  if (!isRecord(value) || typeof value.executeHybridRoutingCore !== "function") {
    throw new Error(
      `runtime module ${runtimeConfiguration.runtimeModulePath} does not export executeHybridRoutingCore`,
    )
  }
  const executor = value.executeHybridRoutingCore
  return (inputJson: string): string => {
    const output: unknown = executor(inputJson)
    if (typeof output !== "string") {
      throw new Error("hybrid routing core executor must return a JSON string")
    }
    return output
  }
}

function getSerializedBytes(value: object): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"

class ControlledWorker {
  onmessage?: (event: { data: Pipeline9LocalWorkerResponse }) => void
  onerror?: (event: ErrorEvent) => void
  messages: Pipeline9LocalWorkerRequest[] = []
  terminated = false
  postMessage(message: Pipeline9LocalWorkerRequest): void { this.messages.push(message) }
  ref(): void {}
  unref(): void {}
  terminate(): void { this.terminated = true }
  complete(index = this.messages.length - 1): void {
    const request = this.messages[index]!
    this.onmessage?.({ data: { taskId: request.taskId, ok: true, result: null } })
  }
}

test("owned pool publishes queue-aware idle capacity without changing external protocols or admitting a fifth worker", async (): Promise<void> => {
  const workers: ControlledWorker[] = []
  const factory = (): Worker => {
    const worker = new ControlledWorker()
    workers.push(worker)
    return worker as unknown as Worker
  }
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  // Exercise the owned protocol deterministically without launching threads.
  ;(pool as unknown as { workerFactory: () => Worker }).workerFactory = factory
  const first = pool.run({ kind: "warmup" })
  const buffer = workers[0]!.messages[0]!.idleWorkerAvailability
  expect(buffer).toBeInstanceOf(SharedArrayBuffer)
  const idle = new Int32Array(buffer!)
  expect(Atomics.load(idle, 0)).toBe(3)
  const others = Array.from({ length: 4 }, () => pool.run({ kind: "warmup" }))
  expect(workers).toHaveLength(4)
  expect(Atomics.load(idle, 0)).toBe(0)
  for (const worker of workers)
    expect(worker.messages[0]!.idleWorkerAvailability).toBe(buffer)
  workers[0]!.complete(0)
  expect(Atomics.load(idle, 0)).toBe(0)
  expect(workers[0]!.messages).toHaveLength(2)
  expect(pool.stats.maxActiveWorkers).toBe(4)
  workers[1]!.complete()
  expect(Atomics.load(idle, 0)).toBe(1)
  workers[2]!.complete()
  workers[3]!.complete()
  workers[0]!.complete(1)
  await Promise.all([first, ...others])
  expect(Atomics.load(idle, 0)).toBe(4)
  expect(pool.stats.tasksStarted).toBe(5)
  expect(pool.stats.tasksCompleted).toBe(5)
  pool.dispose()
  expect(Atomics.load(idle, 0)).toBe(0)
  expect(workers.every((worker) => worker.terminated)).toBe(true)

  const externalWorkers: ControlledWorker[] = []
  const external = new Pipeline9LocalWorkerPool({ workerCount: 1,
    workerFactory: (): Worker => {
      const worker = new ControlledWorker()
      externalWorkers.push(worker)
      return worker as unknown as Worker
    } })
  const externalRun = external.run({ kind: "warmup" })
  expect(externalWorkers[0]!.messages[0]).toEqual({ taskId: 1, job: { kind: "warmup" } })
  externalWorkers[0]!.complete()
  await externalRun
  external.dispose()
})

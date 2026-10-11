import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"

test("eager imports reuse at most four workers and retain startup failure identity", async (): Promise<void> => {
  let created = 0
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4,
    workerFactory: (url: URL): Worker => {
      created++
      return new Worker(url, { type: "module" })
    },
  })
  try {
    pool.start()
    pool.start()
    expect(created).toBe(4)
    expect(pool.stats.tasksStarted).toBe(0)
    expect(pool.stats.maxActiveWorkers).toBe(0)
    await pool.warmup()
    expect(created).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(4)
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally {
    pool.dispose()
  }
  expect(() => pool.start()).toThrow("disposed")
  const failure = new Error("deliberate eager startup failure")
  const failing = new Pipeline9LocalWorkerPool({
    workerFactory: (): Worker => { throw failure },
  })
  try {
    expect(() => failing.start()).toThrow(failure.message)
    await expect(failing.run({ kind: "warmup" })).rejects.toBe(failure)
  } finally {
    failing.dispose()
  }
})

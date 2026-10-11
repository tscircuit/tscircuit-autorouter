import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"

test("worker construction errors reject pending work and permanently stop the pool", async () => {
  const pool = new Pipeline9LocalWorkerPool({
    workerFactory: (): Worker => { throw new Error("deliberate worker startup failure") },
  })
  try {
    await expect(pool.warmup()).rejects.toThrow("deliberate worker startup failure")
    await expect(pool.run({ kind: "warmup" })).rejects.toThrow("deliberate worker startup failure")
    expect(pool.stats.tasksStarted).toBe(0)
  } finally { pool.dispose() }
})

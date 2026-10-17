import { expect, test } from "bun:test"
import { NodeSolverRuntime } from "../../lib/solver-runtime/NodeSolverRuntime"
import { SingleThreadSolverRuntime } from "../../lib/solver-runtime/SolverRuntime"
import { task } from "./fixtures/task"

test("synchronous workers preserve indexed outcomes, isolated inputs, shared memory and reuse", () => {
  const buffer = new SharedArrayBuffer(4)
  new Int32Array(buffer)[0] = 7
  const batch = {
    inputs: Array.from({ length: 20 }, (_, value) => ({ value, fail: value === 4 || value === 9 })),
    shared: { values: [] as number[], buffer },
    runTask: task,
    worker: { moduleUrl: new URL("./fixtures/task.ts", import.meta.url).href, exportName: "task" },
  }
  const serial = new SingleThreadSolverRuntime()
  const expected = serial.runBatch(batch)
  for (const threads of [1, 2, 4]) {
    const runtime = new NodeSolverRuntime({ threads })
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = runtime.runBatch(batch)
        expect(result).not.toBeInstanceOf(Promise)
        expect([...result].sort((a, b) => a.taskIndex - b.taskIndex)).toEqual([...expected])
      }
      expect(() => runtime.runBatch({ ...batch, inputs: [{ value: (() => 1) as any }] })).toThrow()
      expect(runtime.runBatch({ ...batch, inputs: [{ value: 2 }] })).toEqual([{ taskIndex: 0, ok: true, output: 12 }])
    } finally { runtime.dispose() }
    expect(() => runtime.runBatch(batch)).toThrow("disposed")
  }
  expect(batch.shared.values).toEqual([])
  serial.dispose()
})

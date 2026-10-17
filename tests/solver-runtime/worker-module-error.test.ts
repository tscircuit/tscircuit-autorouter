import { expect, test } from "bun:test"
import { NodeSolverRuntime } from "../../lib/solver-runtime/NodeSolverRuntime"

test("a missing worker module fails synchronously and its pool can be disposed", () => {
  const runtime = new NodeSolverRuntime({ threads: 2 })
  try {
    expect(() => runtime.runBatch({
      inputs: [1, 2], shared: undefined, runTask: (input) => input,
      worker: { moduleUrl: new URL("./fixtures/missing-task.ts", import.meta.url).href, exportName: "task" },
    })).toThrow("missing-task")
  } finally { runtime.dispose() }
  expect(() => runtime.runBatch({ inputs: [], shared: undefined, runTask: (input) => input })).toThrow("disposed")
})

import { expect, test } from "bun:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { BENCHMARK_DATASETS, dispatchBenchmarkWorkflows, parseBenchmarkCommand } =
  require("../.github/scripts/benchmark-dispatch.js")

test("benchmark dispatcher parses commands and dispatches independent dataset workflows", async () => {
  const comments: Array<{ body: string; commentId?: number }> = []
  const dispatches: Array<{ ref: string; inputs: Record<string, string> }> = []
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "tscircuit", repo: "autorouter" },
    issue: { number: 42 },
    payload: {
      repository: { default_branch: "main" },
      comment: { body: "/benchmark all 20 --dataset srj15 --effort 2" },
    },
  }
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { head: { sha: "1234567890abcdef" } } }) },
      issues: {
        createComment: async ({ body }: { body: string }) => {
          comments.push({ body })
          return { data: { id: comments.length } }
        },
        updateComment: async ({ body, comment_id }: { body: string; comment_id: number }) => {
          comments.push({ body, commentId: comment_id })
        },
      },
      actions: {
        createWorkflowDispatch: async ({ ref, inputs }: { ref: string; inputs: Record<string, string> }) => {
          dispatches.push({ ref, inputs })
        },
      },
    },
  }

  await dispatchBenchmarkWorkflows({ github, context, core: { warning: () => {} } })

  expect(parseBenchmarkCommand("/benchmarkfoo")).toBeNull()
  expect(() => parseBenchmarkCommand("/benchmark --dataset --pipeline 7")).toThrow(
    "`--dataset` requires a dataset value",
  )
  expect(dispatches.map(({ inputs }) => inputs.dataset_name)).toEqual(
    BENCHMARK_DATASETS.map(({ name }) => name),
  )
  expect(comments).toHaveLength(BENCHMARK_DATASETS.length)
  for (const { ref, inputs } of dispatches) {
    expect(ref).toBe("main")
    expect(inputs.ref).toBe("1234567890abcdef")
    expect(inputs.benchmark_args_json).toBe(
      JSON.stringify(["all", "20", "--effort", "2"]),
    )
  }
})

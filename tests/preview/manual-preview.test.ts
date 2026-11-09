import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const workflow = readFileSync(
  new URL("../../.github/workflows/manual-preview.yml", import.meta.url),
  "utf8",
)
const script = workflow
  .split("          script: |\n")[1]
  .split("\n")
  .map((line: string): string => line.slice(12))
  .join("\n")
const AsyncFunction = Object.getPrototypeOf(
  async function (): Promise<void> {},
).constructor
const sha = "a".repeat(40)
type Options = {
  event?: string
  permission?: string
  fork?: boolean
  closed?: boolean
  missing?: boolean
  failure?: boolean
  reuse?: boolean
  move?: boolean
  bot?: boolean
  command?: string
  commentExists?: boolean
}
type RecordItem = {
  body?: string
  method?: string
  url?: string
  [key: string]: unknown
}
async function run(options: Options = {}): Promise<{
  failures: string[]
  comments: RecordItem[]
  calls: RecordItem[]
  created: RecordItem[]
}> {
  const failures: string[] = []
  const comments: RecordItem[] = []
  const calls: RecordItem[] = []
  const created: RecordItem[] = []
  const pr = {
    state: options.closed ? "closed" : "open",
    base: { ref: "main" },
    head: {
      sha,
      ref: "feature/routing",
      repo: {
        id: 123,
        full_name: options.fork
          ? "elsewhere/fork"
          : "tscircuit/tscircuit-autorouter",
      },
    },
  }
  const event = options.event ?? "issue_comment"
  const payload = {
    sender: { login: "maintainer", type: options.bot ? "Bot" : "User" },
    issue: { number: 42, pull_request: {} },
    comment: { body: options.command ?? "/preview" },
    action: "labeled",
    label: { name: "preview-test" },
    pull_request: { ...pr, number: 42 },
    inputs: { pr_number: "42" },
  }
  let gets = 0
  const github = {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async (): Promise<unknown> => ({
          data: { permission: options.permission ?? "write" },
        }),
      },
      pulls: {
        get: async (): Promise<unknown> => ({
          data:
            options.move && gets++ > 0
              ? { ...pr, head: { ...pr.head, sha: "b".repeat(40) } }
              : pr,
        }),
      },
      issues: {
        listComments: "comments",
        createComment: async (data: RecordItem): Promise<unknown> => {
          comments.push(data)
          return { data: { id: 99 } }
        },
        updateComment: async (data: RecordItem): Promise<void> => {
          comments.push(data)
        },
      },
    },
    paginate: async (): Promise<unknown[]> =>
      options.commentExists
        ? [
            {
              id: 99,
              user: { login: "github-actions[bot]" },
              body: "<!-- tscircuit-manual-preview -->",
            },
          ]
        : [],
  }
  let polls = 0
  const fakeFetch = async (
    input: URL,
    init: { method?: string; body?: string },
  ): Promise<unknown> => {
    calls.push({ url: input.toString(), method: init.method ?? "GET" })
    if (input.pathname === "/v6/deployments")
      return {
        ok: true,
        json: async (): Promise<unknown> => ({
          deployments: options.reuse
            ? [
                {
                  uid: "dpl_test",
                  state: "READY",
                  url: "test.vercel.app",
                  meta: { githubCommitSha: sha, manualPreviewPr: "42" },
                },
              ]
            : [],
        }),
      }
    if (init.method === "POST") {
      const body = JSON.parse(init.body!)
      created.push(body)
      return {
        ok: true,
        json: async (): Promise<unknown> => ({
          id: "dpl_test",
          readyState: "QUEUED",
        }),
      }
    }
    polls++
    return {
      ok: true,
      json: async (): Promise<unknown> => ({
        id: "dpl_test",
        readyState: options.failure
          ? "ERROR"
          : polls === 1
            ? "BUILDING"
            : "READY",
        url: "test.vercel.app",
      }),
    }
  }
  const env = options.missing
    ? {}
    : {
        VERCEL_TOKEN: "test-secret-must-not-appear-in-comments",
        VERCEL_TEAM_ID: "team_test",
        VERCEL_PROJECT_ID: "prj_test",
      }
  await new AsyncFunction(
    "github",
    "context",
    "core",
    "process",
    "fetch",
    "setTimeout",
    script,
  )(
    github,
    {
      repo: { owner: "tscircuit", repo: "tscircuit-autorouter" },
      eventName: event,
      payload,
      runId: 123,
    },
    {
      setFailed: (message: string): void => {
        failures.push(message)
      },
    },
    { env },
    fakeFetch,
    (resolve: () => void): void => {
      resolve()
    },
  )
  assert.ok(
    !JSON.stringify(comments).includes(
      "test-secret-must-not-appear-in-comments",
    ),
  )
  return { failures, comments, calls, created }
}

test("manual previews enforce authorization, pin commits, reuse builds, and report outcomes", async (): Promise<void> => {
  for (const event of ["issue_comment", "pull_request", "workflow_dispatch"]) {
    const result = await run({ event })
    assert.deepEqual(result.failures, [])
    assert.equal(result.created.length, 1)
    assert.equal(result.created[0].target, "preview")
    assert.equal((result.created[0].gitSource as { sha: string }).sha, sha)
    assert.ok(result.comments[0].body!.includes("request received"))
    assert.ok(
      result.comments.some((comment): boolean =>
        comment.body!.includes("queued"),
      ),
    )
    assert.ok(
      result.comments.some((comment): boolean =>
        comment.body!.includes("building"),
      ),
    )
    assert.ok(result.comments.at(-1)!.body!.includes("https://test.vercel.app"))
    assert.ok(
      result.calls.every(
        (call): boolean =>
          new URL(call.url!).searchParams.get("teamId") === "team_test",
      ),
    )
    assert.equal(
      result.comments
        .slice(1)
        .every((comment): boolean => comment.comment_id === 99),
      true,
    )
  }
  for (const options of [
    { permission: "read" },
    { fork: true },
    { closed: true },
    { move: true },
  ]) {
    const result = await run(options)
    assert.equal(result.created.length, 0)
    assert.equal(result.failures.length, 1)
  }
  for (const options of [{ bot: true }, { command: "/preview anything" }]) {
    const result = await run(options)
    assert.equal(result.calls.length, 0)
    assert.equal(result.comments.length, 0)
  }
  const missing = await run({ missing: true })
  assert.equal(missing.created.length, 0)
  assert.ok(
    missing.comments.at(-1)!.body!.includes("Configure the VERCEL_TOKEN"),
  )
  const failure = await run({ failure: true })
  assert.equal(failure.failures.length, 1)
  assert.ok(failure.comments.at(-1)!.body!.includes("View build logs"))
  const reused = await run({ reuse: true, commentExists: true })
  assert.deepEqual(reused.failures, [])
  assert.equal(reused.created.length, 0)
  assert.ok(
    reused.comments.every((comment): boolean => comment.comment_id === 99),
  )
  assert.ok(!workflow.includes("actions/checkout"))
})

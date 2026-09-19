import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("benchmark and profile workflows compare stacked PRs against main", async () => {
  for (const file of ["benchmark.yml", "profile.yml"]) {
    const workflow = readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    )
    const step = workflow.split("- name: Resolve comparison refs")[1]!
    const script = step
      .split("          script: |\n")[1]!
      .split("\n      - name:")[0]!
      .replace(/^ {12}/gm, "")
      .replace(/\$\{\{[^}]+\}\}/g, "workflow-context")
    const outputs: Record<string, string> = {}
    let requestedBranch = ""
    let comment = ""
    const github = {
      rest: {
        pulls: {
          get: async () => ({
            data: {
              base: { ref: "feature/parent", sha: "parent-sha" },
              head: { sha: "pr-head-sha" },
            },
          }),
        },
        repos: {
          getBranch: async ({ branch }: { branch: string }) => {
            requestedBranch = branch
            return {
              data: {
                commit: { sha: branch === "main" ? "main-sha" : "parent-sha" },
              },
            }
          },
        },
        issues: {
          createComment: async ({ body }: { body: string }) => {
            comment = body
            return { data: { id: 123 } }
          },
        },
      },
    }
    const run = new Function(
      "github",
      "context",
      "core",
      "process",
      `return (async () => { ${script} })()`,
    )
    await run(
      github,
      { repo: { owner: "tscircuit", repo: "tscircuit-autorouter" } },
      {
        setOutput: (key: string, value: string): void => {
          outputs[key] = value
        },
      },
      { env: { PR_NUMBER: "2644", DATASET_NAME: "dataset01" } },
    )
    expect(requestedBranch).toBe("main")
    expect(outputs.main_sha).toBe("main-sha")
    expect(outputs.pr_sha).toBe("pr-head-sha")
    expect(comment).toContain("current main `main-sh`")
    expect(comment).not.toContain("parent-sha")
  }
})

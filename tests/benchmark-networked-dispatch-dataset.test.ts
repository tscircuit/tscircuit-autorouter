import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

type DispatchContext = {
  eventName: string
  sha: string
  payload: { inputs: Record<string, string> }
}

type WorkflowCore = {
  setOutput(name: string, value: unknown): void
}

const readBenchmarkParseScript = (): string => {
  const workflow = readFileSync(
    new URL("../.github/workflows/benchmark.yml", import.meta.url),
    "utf8",
  )
  const stepStart = workflow.indexOf("      - name: Parse benchmark command\n")
  const scriptStart = workflow.indexOf("          script: |\n", stepStart)
  const stepEnd = workflow.indexOf("\n      - name:", scriptStart)
  if (stepStart < 0 || scriptStart < stepStart || stepEnd < scriptStart) {
    throw new Error("Could not read the benchmark command workflow script")
  }
  const scriptLines = workflow.slice(scriptStart + "          script: |\n".length, stepEnd).split("\n")
  const dedented: string[] = []
  for (const line of scriptLines) dedented.push(line.slice(12))
  return dedented.join("\n").replace(/\$\{\{[\s\S]*?\}\}/g, "github-expression")
}

test("single-revision networked dispatch honors dataset inputs while argument datasets take precedence", async (): Promise<void> => {
  const runScript = new Function(
    "context", "core", "github",
    `return (async () => {\n${readBenchmarkParseScript()}\n})()`,
  ) as (context: DispatchContext, core: WorkflowCore, github: unknown) => Promise<void>
  for (const fixture of [
    { args: ["--pipeline", "9net"], dataset: "dataset01", expected: ["--pipeline", "9net", "--dataset", "dataset01"] },
    { args: ["--pipeline", "9net", "--dataset", "29"], dataset: "18", expected: ["--pipeline", "9net", "--dataset", "29"] },
    { args: ["--solver", "AutoroutingPipelineSolver9_Networked"], dataset: "18", expected: ["--solver", "AutoroutingPipelineSolver9_Networked", "--dataset", "18"] },
    { args: ["--pipeline", "9net"], dataset: "", expected: ["--pipeline", "9net"] },
    { args: ["--pipeline", "9"], dataset: "18", expected: ["--pipeline", "9"] },
  ]) {
    const outputs = new Map<string, unknown>()
    await runScript(
      { eventName: "workflow_dispatch", sha: "controller-sha", payload: { inputs: {
        benchmark_args_json: JSON.stringify(fixture.args), dataset_name: fixture.dataset,
      } } },
      { setOutput: outputs.set.bind(outputs) },
      {},
    )
    expect(JSON.parse(String(outputs.get("benchmark_args_json")))).toEqual(fixture.expected)
    expect(outputs.get("networked_remote")).toBe("false")
  }
})

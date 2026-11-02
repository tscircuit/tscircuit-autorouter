import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"

test("Pipeline7, Pipeline9 and A13 route and validate without calling checks", async () => {
  // Keep module mocks out of the process running the independent DRC oracle.
  const child = Bun.spawn(
    [process.execPath, "tests/fixtures/autorouter-without-checks.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })

  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith("AUTOROUTER_RESULT="))
  expect(resultLine).toBeDefined()
  const results = JSON.parse(
    resultLine!.slice("AUTOROUTER_RESULT=".length),
  ) as EvaluateRelaxedDrcInput[]
  expect(results).toHaveLength(3)
  for (const result of results) {
    expect(evaluateRelaxedDrc(result).errors).toHaveLength(0)
  }
})

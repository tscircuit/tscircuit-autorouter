import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { captureSourceProblem, getRuleContext } from "./problem_context"

test("source SRJ hashes preserve rule differences without mutating input or raw constructor identity", () => {
  const srj = { layerCount: 2, minTraceToHoleEdgeClearance: 0.15, connections: [], effort: 1 }
  const original = JSON.stringify(srj)
  const context = captureSourceProblem(srj, "sample001", "srj24", 1)
  expect(context.srjSha256).toBe(createHash("sha256").update(original).digest("hex"))
  expect(context.scenarioSha256).toBe(createHash("sha256").update(JSON.stringify({ scenarioName: "sample001", scenario: srj })).digest("hex"))
  expect(JSON.stringify(srj)).toBe(original)
  expect(context.clearanceRuleDeclarations).toEqual({ minTraceToHoleEdgeClearance: 0.15 })
  const changed = captureSourceProblem({ ...srj, minTraceToHoleEdgeClearance: 0.2 }, "sample001", "srj24", 1)
  expect(changed.srjSha256).not.toBe(context.srjSha256)
  const legacy = { nodePortPoints: [], minimumTraceToHoleEdgeClearance: undefined }
  const refined = { nodePortPoints: [], minimumTraceToHoleEdgeClearance: 0.15 }
  expect(getRuleContext(legacy).fieldNames).toEqual(["nodePortPoints"])
  expect(getRuleContext(refined).clearanceRuleDeclarations).toEqual({ minimumTraceToHoleEdgeClearance: 0.15 })
  expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).not.toBe(createHash("sha256").update(JSON.stringify(refined)).digest("hex"))
})

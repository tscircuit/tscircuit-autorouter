import { createHash } from "node:crypto"

export function getRuleContext(source: Record<string, unknown>): {
  fieldNames: string[]
  clearanceRuleDeclarations: Record<string, unknown>
} {
  const fieldNames: string[] = []
  const clearanceRuleDeclarations: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || typeof value === "function" || typeof value === "symbol") continue
    fieldNames.push(name)
    if (/clearance|gap|tracewidth|diameter/i.test(name) &&
      (value === null || ["number", "string", "boolean"].includes(typeof value))) {
      clearanceRuleDeclarations[name] = typeof value === "number" && !Number.isFinite(value) ? null : value
    }
  }
  return { fieldNames: fieldNames.sort(), clearanceRuleDeclarations }
}

export function captureSourceProblem(
  scenario: Record<string, unknown>,
  scenarioName: string,
  dataset: string,
  sampleNumber: number,
): Record<string, unknown> {
  const started = performance.now()
  const text = JSON.stringify(scenario)
  const scenarioText = JSON.stringify({ scenarioName, scenario })
  return {
    schemaVersion: 1,
    srjSha256: createHash("sha256").update(text).digest("hex"),
    scenarioSha256: createHash("sha256").update(scenarioText).digest("hex"),
    bytes: Buffer.byteLength(text), scenarioName, dataset, sampleNumber,
    clearanceRuleDeclarations: getRuleContext(scenario).clearanceRuleDeclarations,
    captureMs: performance.now() - started,
    method: "Exact JSON.stringify of loaded source SRJ after metadata migration and effort override, before runTask/timed solve; scenario hash also includes scenarioName. No configuration fields removed or normalized.",
  }
}

import { appendFileSync } from "node:fs"

type DiagnosticInventory = {
  diagnostics: Array<{ code: string; severity: string }>
  number_of_files: number
  number_of_rules: number
}

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error("Provide the diagnostic JSON path and summary JSON path")
}

const report: DiagnosticInventory = await Bun.file(inputPath).json()
if (
  !Array.isArray(report.diagnostics) ||
  !report.diagnostics.every(
    (diagnostic: DiagnosticInventory["diagnostics"][number]): boolean =>
      diagnostic &&
      typeof diagnostic.code === "string" &&
      diagnostic.severity === "error",
  ) ||
  !Number.isInteger(report.number_of_files) ||
  report.number_of_files < 1 ||
  report.number_of_rules !== 24
) {
  throw new Error(
    "Expected complete Oxlint JSON for 24 rules with error diagnostics",
  )
}

const countsByRule: Record<string, number> = {}
for (const diagnostic of report.diagnostics) {
  countsByRule[diagnostic.code] = (countsByRule[diagnostic.code] ?? 0) + 1
}

const summary = {
  files: report.number_of_files,
  rules: report.number_of_rules,
  errors: report.diagnostics.length,
  countsByRule,
}
const summaryJson = JSON.stringify(summary, null, 2)
await Bun.write(outputPath, `${summaryJson}\n`)
console.log(summaryJson)

const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY
if (stepSummaryPath) {
  appendFileSync(
    stepSummaryPath,
    `### Complete anti-slop diagnostic inventory\n\n${summary.errors} errors across ${summary.files} files, with ${summary.rules} rules active.\n\nThe lint step retains its failure status; this count is informational.\n\n\`\`\`json\n${summaryJson}\n\`\`\`\n`,
  )
}

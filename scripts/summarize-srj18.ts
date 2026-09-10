import { summarizeResults } from "./srj18Profile/summarizeResults"
import { renderReportHtml } from "./srj18Profile/renderReportHtml"
import { renderReportMarkdown } from "./srj18Profile/renderReportMarkdown"

if (!process.argv[2])
  throw new Error("Usage: bun scripts/summarize-srj18.ts RESULTS_DIRECTORY")
await summarizeResults(process.argv[2])
await renderReportMarkdown(process.argv[2])
await renderReportHtml(process.argv[2])

import { summarizeCpuProfiles } from "./srj18Profile/summarizeCpuProfiles"

if (!process.argv[2]) throw new Error("Usage: bun scripts/summarize-srj18-cpu.ts RESULTS_DIRECTORY")
await summarizeCpuProfiles(process.argv[2])

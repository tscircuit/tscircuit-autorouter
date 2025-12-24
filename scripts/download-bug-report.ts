#! /usr/bin/env bun

import fs from "node:fs"
import path from "node:path"
import { $ } from "bun"

// Get the bug report ID from command line arguments
const bugReportArg = process.argv[2]

if (!bugReportArg) {
  console.error("Please provide a bug report URL or UUID as an argument")
  process.exit(1)
}

// Extract UUID from the argument
let uuid: string
if (bugReportArg.includes("autorouting_bug_report_id=")) {
  // Extract from URL
  const match = bugReportArg.match(/autorouting_bug_report_id=([^&]+)/)
  if (!match) {
    console.error("Could not extract UUID from URL")
    process.exit(1)
  }
  uuid = match[1]
} else if (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    bugReportArg,
  )
) {
  // Direct UUID
  uuid = bugReportArg
} else {
  console.error("Invalid bug report URL or UUID")
  process.exit(1)
}

// Construct download URL
const downloadUrl = `https://api.tscircuit.com/autorouting/bug_reports/get?autorouting_bug_report_id=${uuid}&download=true`

// Create directory for bug reports if it doesn't exist
const bugReportsDir = path.join("examples", "bug-reports")
if (!fs.existsSync(bugReportsDir)) {
  fs.mkdirSync(bugReportsDir, { recursive: true })
}

// Find highest bug report number
let highestNum = 0
const existingDirs = fs.readdirSync(bugReportsDir)
for (const dir of existingDirs) {
  const match = dir.match(/^bugreport(\d+)/)
  if (match) {
    const num = parseInt(match[1], 10)
    if (num > highestNum) {
      highestNum = num
    }
  }
}

// Create new bug report number and shortened UUID
const newBugReportNum = highestNum + 1
const shortUuid = uuid.substring(0, 6)
const dirName = `bugreport${newBugReportNum}-${shortUuid}`
const dirPath = path.join(bugReportsDir, dirName)
const jsonFileName = `${dirName}.json`
const jsonFilePath = path.join(dirPath, jsonFileName)
const fixtureFileName = `${dirName}.fixture.tsx`
const fixtureFilePath = path.join(dirPath, fixtureFileName)

// Create directory
fs.mkdirSync(dirPath, { recursive: true })

// Download the JSON file
console.log(`Downloading bug report from ${downloadUrl}...`)
try {
  const response = await fetch(downloadUrl)
  const data = await response.json()
  fs.writeFileSync(
    jsonFilePath,
    JSON.stringify(data.autorouting_bug_report, null, 2),
  )
  console.log(`\nBug report saved to ${jsonFilePath}`)
} catch (error) {
  console.error("Failed to download bug report:", error)
  process.exit(1)
}

// Create fixture file
const fixtureTemplate = `// @ts-nocheck\nimport { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./${jsonFileName}"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
}
`

fs.writeFileSync(fixtureFilePath, fixtureTemplate)
console.log(`\n\nFixture file created at ${fixtureFilePath}`)

console.log(
  `Bug report "${newBugReportNum}-${shortUuid}" successfully downloaded and set up`,
)

console.log("Running format...")
await $`bun run format`

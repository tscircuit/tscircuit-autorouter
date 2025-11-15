#! /usr/bin/env bun

import fs from "node:fs"
import path from "node:path"

const bugReportArg = process.argv[2]

if (!bugReportArg) {
  console.error("Please provide a bug report URL or UUID as an argument")
  process.exit(1)
}

let uuid: string
if (bugReportArg.includes("autorouting_bug_report_id=")) {
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
  uuid = bugReportArg
} else {
  console.error("Invalid bug report URL or UUID")
  process.exit(1)
}

const downloadUrl = `https://api.tscircuit.com/autorouting/bug_reports/get?autorouting_bug_report_id=${uuid}&download=true`

const bugReportsDir = path.join("examples", "bug-reports")
if (!fs.existsSync(bugReportsDir)) {
  fs.mkdirSync(bugReportsDir, { recursive: true })
}

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

const newBugReportNum = highestNum + 1
const shortUuid = uuid.substring(0, 6)
const dirName = `bugreport${newBugReportNum}-${shortUuid}`
const dirPath = path.join(bugReportsDir, dirName)
const jsonFileName = `${dirName}.json`
const jsonFilePath = path.join(dirPath, jsonFileName)
const fixtureFileName = `${dirName}.fixture.tsx`
const fixtureFilePath = path.join(dirPath, fixtureFileName)
const testFileName = `${dirName}.test.ts`
const testsBugsDir = path.join("tests", "bugs")
const testFilePath = path.join(testsBugsDir, testFileName)

fs.mkdirSync(dirPath, { recursive: true })
if (!fs.existsSync(testsBugsDir)) {
  fs.mkdirSync(testsBugsDir, { recursive: true })
}

console.log(`Downloading bug report from ${downloadUrl}...`)
let bugReportJson: unknown
try {
  const response = await fetch(downloadUrl)
  const data = await response.json()
  bugReportJson = data.autorouting_bug_report
  if (
    !bugReportJson ||
    typeof bugReportJson !== "object" ||
    !("simple_route_json" in (bugReportJson as Record<string, unknown>))
  ) {
    console.error("Downloaded bug report did not include simple_route_json")
    process.exit(1)
  }
  fs.writeFileSync(jsonFilePath, JSON.stringify(bugReportJson, null, 2))
  console.log(`\nBug report saved to ${jsonFilePath}`)
} catch (error) {
  console.error("Failed to download bug report:", error)
  process.exit(1)
}

const fixtureTemplate = `
// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./${jsonFileName}";
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
`

fs.writeFileSync(fixtureFilePath, fixtureTemplate)
console.log(`Fixture file created at ${fixtureFilePath}`)

const testTemplate = `import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../examples/bug-reports/${dirName}/${jsonFileName}" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("${jsonFileName}", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
`

fs.writeFileSync(testFilePath, testTemplate)
console.log(`Snapshot test created at ${testFilePath}`)

console.log(
  `\nBug report "${newBugReportNum}-${shortUuid}" successfully downloaded with fixture and test.`,
)

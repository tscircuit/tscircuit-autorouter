import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import { relaxTraceClearance } from "@tscircuit/repair04"

const [inputFile, expectedDirectory, outputDirectory] = process.argv.slice(2)
if (!inputFile || !expectedDirectory || !outputDirectory) throw new Error("Expected input, expected output directory and output directory")
mkdirSync(outputDirectory, { recursive: true })
const parameters: Parameters<typeof relaxTraceClearance>[0] = JSON.parse(gunzipSync(readFileSync(inputFile)).toString())
const observations: Array<{ key: string; hash: string }> = JSON.parse(readFileSync(`${expectedDirectory}/records.json`, "utf8"))
const expectedHash = observations.find((record) => record.key === "projection-after")?.hash
if (!expectedHash) throw new Error("Missing original projection output")
const expected = gunzipSync(readFileSync(`${expectedDirectory}/${expectedHash}.json.gz`)).toString()
const nativeHypot = Math.hypot
const calls: number[][] = []
let callCount = 0
Math.hypot = (...args: number[]): number => {
  const result = nativeHypot(...args)
  if (callCount < 100_000) calls.push([...args, result])
  callCount++
  return result
}
try {
  const output = JSON.stringify(relaxTraceClearance(parameters))
  writeFileSync(`${outputDirectory}/output.json.gz`, gzipSync(output))
  if (output !== expected) throw new Error("Isolated projection differs from full-board projection")
  console.log("Isolated projection exactly matches the original full-board projection", { callCount, capturedCalls: calls.length })
} finally {
  Math.hypot = nativeHypot
  writeFileSync(`${outputDirectory}/hypot-calls.json.gz`, gzipSync(JSON.stringify(calls)))
}

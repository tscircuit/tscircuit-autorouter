import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const here = path.dirname(fileURLToPath(import.meta.url))
const datasetDirectory = process.env.ROUTING_DATASET_DIRECTORY ?? path.resolve(here, "../work/recorded/inputs")
const samples = fs.readdirSync(datasetDirectory).filter((name) => /^sample\d+\.json$/.test(name)).sort()
const concurrency = Number(process.env.ROUTING_CONCURRENCY ?? "4")
let nextSample = 0
async function runQueue() {
  while (nextSample < samples.length) {
    const sample = samples[nextSample++]
    const child = spawn(process.execPath, [path.join(here, "runTscircuit.mjs"), sample], { stdio: "inherit", env: { ...process.env, ROUTING_CONCURRENCY: String(concurrency) } })
    const code = await new Promise((resolve) => child.on("exit", resolve))
    if (code !== 0) throw new Error(`Baseline runner exited ${code} for ${sample}`)
  }
}
await Promise.all(Array.from({ length: concurrency }, runQueue))

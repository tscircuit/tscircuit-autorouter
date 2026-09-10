import { mkdirSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== "--mode" || !["node", "sample"].includes(args[1])) {
  throw new Error("Usage: node scripts/speed-experiments/compare.mjs --mode node|sample")
}
const mode = args[1]
const root = process.env.EXPERIMENT_RESULTS
if (!root) throw new Error("EXPERIMENT_RESULTS must name the result directory")
mkdirSync(root, { recursive: true })

const approaches = ["baseline", "bounded-growth", "coarse-first", "stagnation-growth", "reduced-breadth"]
const cases = []
if (mode === "node") {
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const offset = repeat * 2
    const order = [...approaches.slice(offset), ...approaches.slice(0, offset)]
    for (const approach of order) cases.push({ mode, approach, repeat: repeat + 1 })
  }
} else {
  for (const approach of approaches) cases.push({ mode, approach, repeat: 1 })
}
writeFileSync(`${root}/${mode}-planned-cases.json`, JSON.stringify(cases, null, 2) + "\n")

const outcomes = []
let executionFailed = false
for (const testCase of cases) {
  const id = `${testCase.mode}-${testCase.approach}-${testCase.repeat}`
  const output = `${root}/${id}`
  mkdirSync(output, { recursive: true })
  const timeoutMs = testCase.mode === "node" ? 180_000 : 1_200_000
  const commandArgs = ["scripts/speed-experiments/run.ts", "--mode", testCase.mode, "--approach", testCase.approach, "--output", output]
  const startedAt = new Date().toISOString()
  console.log(`::group::${id} (timeout ${timeoutMs / 1000}s)`)
  const start = performance.now()
  const execution = spawnSync("bun", commandArgs, {
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  })
  const elapsedProcessMs = performance.now() - start
  writeFileSync(`${output}/stdout.log`, execution.stdout || "")
  writeFileSync(`${output}/stderr.log`, execution.stderr || "")
  const outcome = {
    ...testCase,
    id,
    startedAt,
    endedAt: new Date().toISOString(),
    elapsedProcessMs,
    timeoutMs,
    exitStatus: execution.status,
    signal: execution.signal,
    timedOut: execution.error?.code === "ETIMEDOUT",
    processError: execution.error ? { message: execution.error.message, code: execution.error.code } : null,
  }
  writeFileSync(`${output}/process.json`, JSON.stringify(outcome, null, 2) + "\n")
  outcomes.push(outcome)
  writeFileSync(`${root}/${mode}-execution-results.json`, JSON.stringify(outcomes, null, 2) + "\n")
  console.log(JSON.stringify(outcome))
  if (execution.status !== 0 || execution.error) {
    executionFailed = true
    console.log(execution.stderr || execution.stdout || "Process exited without output")
    console.log(`::error::${id} did not exit successfully; result remains an explicit failed or timed-out case.`)
  }
  console.log("::endgroup::")
}

const lines = [
  `## SRJ18 sample 2 search policy experiment: ${mode}`,
  "",
  `Runner: ${process.env.EXPERIMENT_RUNNER_NAME}. All ${cases.length} cases ran sequentially in fresh Bun 1.3.8 processes.`,
  "",
  mode === "node"
    ? "Node timings use three repetitions in rotated order."
    : "Full sample timings use one run per approach.",
  "Process elapsed time below includes loading and artifact writing; use the harness result for solver time and DRC quality.",
  "",
  "| Case | Process exit | Timed out | Process seconds |",
  "| --- | ---: | --- | ---: |",
  ...outcomes.map(row => `| ${row.id} | ${row.exitStatus === null ? row.signal : row.exitStatus} | ${row.timedOut} | ${(row.elapsedProcessMs / 1000).toFixed(2)} |`),
]
writeFileSync(`${root}/${mode}-execution-summary.md`, lines.join("\n") + "\n")
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" })
}
if (executionFailed) process.exit(1)

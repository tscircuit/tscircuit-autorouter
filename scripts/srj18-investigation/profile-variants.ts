import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve("../profile-source")
const variants: Record<string, Record<string, string>> = JSON.parse(readFileSync("source-variants.json", "utf8"))
const { loadScenarios } = await import(resolve(root, "scripts/benchmark/scenarios.ts"))
const scenarios = await loadScenarios("srj18", {})
const samples = [11, 16]
mkdirSync("profile-results", { recursive: true })
for (const sample of samples) {
  for (const [pass, variant] of ["base", "head", "factory", "factory", "head", "base"].entries()) {
    for (const [path, source] of Object.entries(variants[variant]!)) writeFileSync(resolve(root, path), source)
    const output = resolve(`profile-results/${sample}-${pass}-${variant}.json`)
    const child = Bun.spawn([process.execPath, "scripts/srj18-investigation/diagnostic.child.ts"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: Bun.file(`profile-results/${sample}-${pass}-${variant}.stderr.log`), env: { ...process.env, BUN_JSC_reportTotalCompileTimes: "1", DIAGNOSTIC_OUTPUT: output } })
    const deadline = setTimeout(() => child.kill("SIGKILL"), 240000)
    const stdoutPromise = new Response(child.stdout).text()
    const [scenarioName, scenario] = scenarios[sample - 1]!
    child.stdin.write(JSON.stringify({ taskId: sample * 10 + pass, task: { datasetName: "srj18", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName, sampleNumber: sample, scenario } }) + "\n")
    child.stdin.end()
    const [code, stdout] = await Promise.all([child.exited, stdoutPromise])
    clearTimeout(deadline)
    if (code !== 0) throw new Error(`Profile process failed: ${sample}/${variant}/${pass}; ${stdout.slice(-1000)}`)
    const line = stdout.split("\n").find((line) => line.startsWith("DIAGNOSTIC_RESULT "))
    if (!line) throw new Error("Missing diagnostic result")
    console.log("PROFILE_VARIANT " + JSON.stringify({ sample, pass, variant, usage: child.resourceUsage(), diagnostic: JSON.parse(line.slice("DIAGNOSTIC_RESULT ".length)) }))
  }
}

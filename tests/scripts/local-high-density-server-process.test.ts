import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { AUTOROUTER_VERSION } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"

type LocalWorkerResponse = {
  ok: boolean
  source: "cache" | "solver"
  status: "solved" | "failed"
  solutionStage: string
  routes: Array<{ regionId?: string }>
}

test("one pinned local server runs checkout helper, isolates cache namespaces and exits cleanly", async () => {
  // This functional check runs one tiny job, without approving a benchmark
  // resource plan or requiring visibility into all host cgroup ancestors.
  const firstAllowedCpu = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1]
  if (firstAllowedCpu === undefined) throw new Error("Cannot locate an allowed CPU for the local worker test")
  const cpuId = Number(firstAllowedCpu)
  expect(Number.isSafeInteger(cpuId)).toBe(true)
  const entrypoint = fileURLToPath(new URL("../../scripts/benchmark/localHighDensityServerProcess.ts", import.meta.url))
  const child = spawn("taskset", ["-c", String(cpuId), process.execPath, entrypoint, AUTOROUTER_VERSION], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: ["pipe", "pipe", "pipe"],
  })
  const stdout = createInterface({ input: child.stdout })
  let stderr = ""
  child.stderr.on("data", (chunk: Buffer): void => { stderr += chunk.toString() })
  const exited = new Promise<void>((resolve): void => { child.once("exit", (): void => { resolve() }) })
  try {
    const url = await new Promise<string>((resolve, reject): void => {
      child.once("error", reject)
      child.once("exit", (): void => { reject(new Error(`Local worker exited before readiness: ${stderr}`)) })
      stdout.on("line", (line: string): void => {
        if (line.startsWith("LOCAL_HD_READY ")) {
          const ready = JSON.parse(line.slice("LOCAL_HD_READY ".length))
          expect(ready.pid).toBe(child.pid)
          expect(ready.autorouterVersion).toBe(AUTOROUTER_VERSION)
          resolve(ready.url)
        }
      })
    })
    const baseInput = {
      solvePolicy: "ordinary_then_regional_without_fixed_copper_v1", enableRegionalFallback: false,
      nodeWithPortPoints: { capacityMeshNodeId: "node-a", center: { x: 0, y: 0 }, width: 2, height: 2,
        portPoints: [{ x: -1, y: 0, z: 0, connectionName: "trace" }, { x: 1, y: 0, z: 0, connectionName: "trace" }] },
      connectivityNetMap: { trace: ["trace"] }, colorMap: {}, viaDiameter: 0.3,
      traceWidth: 0.15, obstacleMargin: 0.2, effort: 1,
      obstacles: [], regionalObstacles: [], layerCount: 2, nodePf: null,
    }
    const send = async (input: typeof baseInput, cacheVersion: string): Promise<LocalWorkerResponse> => {
      const response = await fetch(`${url}/solve`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ autorouterVersion: AUTOROUTER_VERSION, cacheVersion, input }) })
      expect(response.status).toBe(200)
      return await response.json() as LocalWorkerResponse
    }
    const first = await send(baseInput, "sample-1")
    const otherOwner = await send({ ...baseInput, nodeWithPortPoints: { ...baseInput.nodeWithPortPoints, capacityMeshNodeId: "node-b" } }, "sample-1")
    expect(first).toMatchObject({ ok: true, source: "solver", status: "solved", solutionStage: "ordinary" })
    expect(first.routes.every((route): boolean => route.regionId === "node-a")).toBe(true)
    expect(otherOwner.routes.every((route): boolean => route.regionId === "node-b")).toBe(true)
    expect(await send(baseInput, "sample-1")).toEqual({ ...first, source: "cache" })
    expect((await send(baseInput, "sample-2")).source).toBe("solver")
    expect(await (await fetch(`${url}/stats`)).json()).toMatchObject({ jobsComputed: 3, cacheHits: 1 })
  } finally {
    child.kill("SIGTERM")
    await exited
    stdout.close()
  }
  expect(child.exitCode).toBe(0)
  expect(() => process.kill(child.pid!, 0)).toThrow()
})

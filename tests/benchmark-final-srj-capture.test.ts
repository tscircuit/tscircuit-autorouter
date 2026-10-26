import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types/srj-types"
import { runTask } from "../scripts/benchmark/benchmark-run-task"
import { logCapturedFinalSrjs, parseArgs } from "../scripts/benchmark"

test("opt-in final SRJ capture preserves output, getter calls and recoverable log bytes", async (): Promise<void> => {
  const scenario: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [{
      type: "pcb_trace",
      pcb_trace_id: "existing-trace",
      connection_name: "net1",
      route: [
        { route_type: "wire", x: -1, y: -1, layer: "top", width: 0.2 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.2 },
      ],
    }],
  }
  const task = {
    datasetName: "unit-test",
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "preloaded-trace",
    sampleNumber: 1,
    scenario,
  }
  const prototype = AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype
  const originalGetter = prototype.getOutputSimpleRouteJson
  const originalSolve = prototype.solveAsync
  const outputs: SimpleRouteJson[] = []
  prototype.getOutputSimpleRouteJson = function (): SimpleRouteJson {
    const output = originalGetter.call(this)
    outputs.push(output)
    return output
  }
  const directory = mkdtempSync(join(tmpdir(), "benchmark-final-srj-"))
  try {
    expect(parseArgs([]).captureFinalSrj).toBeUndefined()
    expect(parseArgs(["--capture-final-srj"]).captureFinalSrj).toBe(true)
    writeFileSync(
      join(directory, "bun"),
      '#!/bin/sh\nif [ "$1" = "--eval" ]; then echo 1; else printf "%s\\n" "$@"; fi\n',
      { mode: 0o755 },
    )
    const wrapper = spawnSync(
      "bash",
      ["benchmark.sh", "--pipeline", "9", "--capture-final-srj"],
      {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, PATH: directory + ":" + process.env.PATH },
        encoding: "utf8",
      },
    )
    expect(wrapper.status).toBe(0)
    expect(wrapper.stdout).toContain("--capture-final-srj\n")

    const normal = await runTask(task)
    expect(normal.didSolve).toBe(true)
    expect(normal.error).toBeUndefined()
    expect(Object.hasOwn(normal, "finalSrj")).toBe(false)
    expect(JSON.stringify(normal)).not.toContain('"finalSrj"')
    const normalGetterCalls = outputs.length
    expect(normalGetterCalls).toBe(2)
    outputs.length = 0

    const captured = await runTask({ ...task, captureFinalSrj: true })
    expect(captured.didSolve).toBe(true)
    expect(captured.error).toBeUndefined()
    expect(outputs.length).toBe(normalGetterCalls)
    expect(captured.finalSrj).toBe(outputs[0])
    expect(captured.finalSrj).toEqual(outputs[1])
    expect(captured.finalSrj?.traces).toEqual(scenario.traces)
    const report = JSON.parse(JSON.stringify({ tests: [captured] }))
    expect(report.tests[0].finalSrj).toEqual(captured.finalSrj)

    const loggedSrj: SimpleRouteJson = {
      ...scenario,
      connections: Array.from({ length: 1200 }, (_, index) => ({
        name: `${createHash("sha256").update(String(index)).digest("hex")} π\nline`,
        pointsToConnect: [],
      })),
    }
    const lines: string[] = []
    logCapturedFinalSrjs([normal], (line) => lines.push(line))
    expect(lines).toEqual([])
    logCapturedFinalSrjs(
      [{ ...captured, finalSrj: loggedSrj }],
      (line) => lines.push(line),
    )
    const begin = JSON.parse(lines[0].replace("BENCHMARK_FINAL_SRJ_BEGIN ", ""))
    const end = JSON.parse(lines.at(-1)!.replace("BENCHMARK_FINAL_SRJ_END ", ""))
    expect(begin.chunkCount).toBeGreaterThan(1)
    expect(lines.every((line) => line.length <= 4096)).toBe(true)
    expect(lines.length).toBe(begin.chunkCount + 2)
    const chunks = lines.slice(1, -1).map((line, index) => {
      const match = line.match(/^BENCHMARK_FINAL_SRJ_CHUNK 0 (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/)!
      expect(Number(match[1])).toBe(index + 1)
      expect(Number(match[2])).toBe(begin.chunkCount)
      return match[3]
    })
    const compressed = Buffer.from(chunks.join(""), "base64")
    const recovered = gunzipSync(compressed)
    expect(compressed.length).toBe(begin.gzipBytes)
    expect(recovered.length).toBe(begin.rawBytes)
    expect(recovered.toString("utf8")).toBe(JSON.stringify(loggedSrj))
    expect(JSON.parse(recovered.toString("utf8"))).toEqual(loggedSrj)
    expect(createHash("sha256").update(recovered).digest("hex")).toBe(begin.sha256)
    expect(end).toEqual({ captureIndex: 0, sha256: begin.sha256 })

    outputs.length = 0
    prototype.solveAsync = async function (): Promise<void> {
      throw new Error("intentional unsolved capture control")
    }
    const failed = await runTask({ ...task, captureFinalSrj: true })
    expect(failed.didSolve).toBe(false)
    expect(failed.error).toContain("intentional unsolved capture control")
    expect(Object.hasOwn(failed, "finalSrj")).toBe(false)
    expect(outputs.length).toBe(0)
  } finally {
    prototype.getOutputSimpleRouteJson = originalGetter
    prototype.solveAsync = originalSolve
    rmSync(directory, { recursive: true, force: true })
  }
})

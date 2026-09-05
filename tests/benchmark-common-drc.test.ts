import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EvaluateRelaxedDrcInput } from "../lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "../lib/testing/getBugReportSnapshotSvg"
import { runTask } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"
import "./fixtures/svg-matcher"

test("one harness checks isolated solver checkouts and saves replayable routes", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-common-drc-"))
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "FixtureSolver",
    scenarioName: "via-span",
    sampleNumber: 1,
    scenario: {
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [
        {
          name: "SIGNAL",
          pointsToConnect: [
            { x: -1, y: 0, layer: "inner1", pcb_port_id: "pcb_port_a" },
            { x: 1, y: 0, layer: "inner1", pcb_port_id: "pcb_port_b" },
          ],
        },
      ],
    },
  }
  try {
    for (const [revision, traceY, expectedCount] of [
      ["main", 0, 1],
      ["pr", 1, 0],
    ] as const) {
      const solverRoot = join(directory, revision)
      await Bun.write(
        join(solverRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "lib/*": ["lib/*"] } },
        }),
      )
      await Bun.write(
        join(solverRoot, "lib/route-config.ts"),
        `export const traceY = ${JSON.stringify(traceY)}`,
      )
      await Bun.write(
        join(solverRoot, "lib/index.ts"),
        `import { traceY } from "lib/route-config"
export class FixtureSolver {
  solved = false
  pipelineDef = []
  timeSpentOnPhase = {}
  solve() { this.solved = true }
  getOutputSimplifiedPcbTraces() {
    return [
      { type: "pcb_trace", pcb_trace_id: "via", connection_name: "VIA", route: [
        { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom" }
      ] },
      { type: "pcb_trace", pcb_trace_id: "signal", connection_name: "SIGNAL", route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "inner1", start_pcb_port_id: "pcb_port_a" },
        { route_type: "wire", x: -0.5, y: traceY, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 0.5, y: traceY, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1", end_pcb_port_id: "pcb_port_b" }
      ] }
    ]
  }
}`,
      )
      const routedOutputDirectory = join(directory, revision, "outputs")
      const result = await runTask(structuredClone(task), {
        solverRoot,
        routedOutputDirectory,
      })
      expect(result.error).toBeUndefined()
      expect(result.didSolve).toBe(true)
      expect(result.drcErrorCount).toBe(expectedCount)
      const replay: EvaluateRelaxedDrcInput = await Bun.file(
        join(routedOutputDirectory, "FixtureSolver-1.json"),
      ).json()
      expect(replay.inputSrj).toEqual(task.scenario)
      expect(replay.routedTraces[0]!.route[0]).toMatchObject({
        from_layer: "top",
        to_layer: "bottom",
      })
      expect(replay.routedTraces[1]!.route[1]).toMatchObject({ y: traceY })
      await expect(getBugReportSnapshotSvg(replay)).toMatchSvgSnapshot(
        import.meta.path,
        { svgName: revision },
      )
    }
    await expect(
      runTask(task, { solverRoot: join(directory, "missing") }),
    ).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

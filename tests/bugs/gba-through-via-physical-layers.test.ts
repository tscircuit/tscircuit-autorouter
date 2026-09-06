import { checkViaPadClearance } from "@tscircuit/checks"
import { beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PipelineStageDebugRunner } from "lib/testing/PipelineStageDebugRunner"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

describe.skipIf(process.env.RUN_GBA_THROUGH_VIA_REPRO !== "1")(
  "full GBA through-via physical layer repro",
  (): void => {
    let outsideLogicalSpanViolations: ReturnType<typeof checkViaPadClearance>

    beforeAll(async (): Promise<void> => {
      const inputBytes = await readFile(
        new URL(
          "../../fixtures/bug-reports/gba-through-via-physical-layers/gba-through-via-physical-layers.srj.json",
          import.meta.url,
        ),
      )
      const inputSha256 = createHash("sha256").update(inputBytes).digest("hex")
      expect(inputSha256).toBe(
        "aa8aae92f1f829a02d808d7590cf276882619dfa90693eb7c18094a060a7ac6b",
      )
      const srj = JSON.parse(inputBytes.toString()) as SimpleRouteJson & {
        allowBlindAndBuriedVias: boolean
      }
      expect(srj.connections).toHaveLength(145)
      expect(srj.obstacles).toHaveLength(411)
      expect(srj.traces).toBeUndefined()
      expect(srj.layerCount).toBe(4)
      expect(srj.allowBlindAndBuriedVias).toBeFalse()

      const outputDir = "dist/gba-through-via-physical-layers"
      await mkdir(outputDir, { recursive: true })
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        structuredClone(srj),
        { cacheProvider: null, effort: 1 },
      )
      const runner = new PipelineStageDebugRunner({
        pipelineSolver: solver,
        outputDir: `${outputDir}/stages`,
        writeSvg: true,
        writeGraphicsJson: true,
        context: { inputSha256, pipeline: 9, effort: 1 },
        onLog: (line: string): void => {
          console.log(line)
        },
      })
      const result = await runner.run()
      await writeFile(
        `${outputDir}/run.json`,
        JSON.stringify({ inputSha256, ...result }, null, 2),
      )

      // Setup failures must not satisfy the expected DRC failure below.
      expect(result.error).toBeNull()
      expect(result.failed).toBeFalse()
      expect(result.solved).toBeTrue()
      const traces = solver.getOutputSimplifiedPcbTraces()
      expect(traces.length).toBeGreaterThan(0)
      await writeFile(
        `${outputDir}/routed-traces.json`,
        JSON.stringify(traces, null, 2),
      )
      await writeFile(
        `${outputDir}/routed.svg`,
        getSvgFromGraphicsObject(
          convertSrjToGraphicsObject({ ...srj, traces }),
          { backgroundColor: "white" },
        ),
      )
      const circuitJson = convertToCircuitJson(
        solver.srjWithPointPairs!,
        traces,
        { originalSrj: srj, includeOriginalConnections: true },
      )
      const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
      connMap.addConnections(
        circuitJson.flatMap((element) =>
          element.type === "pcb_via" && element.pcb_trace_id
            ? [[element.pcb_via_id, element.pcb_trace_id]]
            : [],
        ),
      )
      const drcOptions = {
        connMap,
        minClearance: srj.minViaEdgeToPadEdgeClearance,
      }
      const logicalSpanViolations = checkViaPadClearance(
        circuitJson,
        drcOptions,
      )
      const logicalPairs = new Set(
        logicalSpanViolations.map((error) => error.pcb_pad_ids.join("|")),
      )

      // Match Core's physical through-hole construction. This changes only
      // the DRC view of each via's occupied layers, never routed geometry.
      const physicalLayers = Array.from({ length: srj.layerCount }, (_, z) =>
        mapZToLayerName(z, srj.layerCount),
      )
      for (const element of circuitJson) {
        if (element.type === "pcb_via") element.layers = [...physicalLayers]
      }
      const physicalViaPadViolations = checkViaPadClearance(
        circuitJson,
        drcOptions,
      )
      outsideLogicalSpanViolations = physicalViaPadViolations.filter(
        (error) => !logicalPairs.has(error.pcb_pad_ids.join("|")),
      )
      await writeFile(
        `${outputDir}/physical-circuit.json`,
        JSON.stringify(circuitJson, null, 2),
      )
      await writeFile(
        `${outputDir}/physical-via-pad-report.json`,
        JSON.stringify(
          {
            inputSha256,
            logicalSpanViolations,
            physicalViaPadViolations,
            outsideLogicalSpanViolations,
          },
          null,
          2,
        ),
      )
      console.log(
        `Physical via/pad violations: ${physicalViaPadViolations.length}; outside logical span: ${outsideLogicalSpanViolations.length}`,
      )
    })

    test.failing(
      "through vias must clear foreign pads outside their logical transition span",
      (): void => {
        expect(outsideLogicalSpanViolations).toEqual([])
      },
    )
  },
)

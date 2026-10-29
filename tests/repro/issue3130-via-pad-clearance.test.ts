import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import type { Circle, GraphicsObject } from "graphics-debug"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import {
  issue3130Input,
  issue3130Traces,
} from "../fixtures/issue3130-via-pad-clearance"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("issue 3130: reference DRC reports and maps both via-to-pad clearances", async (): Promise<void> => {
  const input = structuredClone(issue3130Input)
  const traces = structuredClone(issue3130Traces)
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: traces,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  const viaPadErrors = checkViaPadClearance(drc.circuitJson)
  expect(viaPadErrors).toHaveLength(2)
  for (const [index, error] of viaPadErrors.entries()) {
    const via = traces[index]!.route.find((point) => point.route_type === "via")
    if (!via || via.route_type !== "via" || !via.via_diameter) {
      throw new Error("The reproduction must retain its physical via")
    }
    // Independent edge-to-edge measurement: x - half pad width - via radius.
    const gap = via.x - input.obstacles[index]!.width / 2 - via.via_diameter / 2
    expect(gap).toBeCloseTo(index === 0 ? 0.15 : 0.17, 9)
    expect(error.actual_clearance).toBeCloseTo(gap, 9)
    expect(error.minimum_clearance).toBe(0.2)
    expect(error.pcb_pad_ids).toContain(`neighbor_pad_${index}`)
    expect(gap).toBeLessThan(error.minimum_clearance!)
  }

  expect(drc.errors).toHaveLength(2)
  expect(drc.locationAwareErrors).toHaveLength(2)
  expect(drc.errors).toMatchObject(
    traces.map((trace) => ({ pcb_trace_id: trace.pcb_trace_id })),
  )
  const repairErrors = normalizePipeline9DrcErrorsForRepair({
    errors: drc.errors as unknown as Record<string, unknown>[],
    circuitJson: drc.circuitJson,
    newTraceIds: new Set(traces.map((trace) => trace.pcb_trace_id)),
  })
  for (const [index, error] of repairErrors.entries()) {
    expect(error).toMatchObject(viaPadErrors[index]!)
    expect(getDrcErrorTraceIds(error)).toEqual([traces[index]!.pcb_trace_id])
    expect(error.pcb_trace_id).toBe(traces[index]!.pcb_trace_id)
    expect(
      drc.circuitJson.find(
        (element) =>
          element.type === "pcb_trace" &&
          element.pcb_trace_id === error.pcb_trace_id,
      ),
    ).toMatchObject({ source_trace_id: input.connections[index]!.name })
  }

  const graphics: GraphicsObject = convertSrjToGraphicsObject({
    ...input,
    traces,
  })
  graphics.points = []
  const measurements = viaPadErrors.map((error, index) => ({
    x: 1.2,
    y: index * 3 - 0.65,
    text: `${error.actual_clearance!.toFixed(3)} mm gap / ${error.minimum_clearance!.toFixed(3)} mm required`,
    fontSize: 0.13,
    anchorSide: "center" as const,
    color: "#b91c1c",
  }))
  await expect(
    getGraphicsSvgFrames({
      columns: 2,
      cellWidth: 3.5,
      cellHeight: 5.6,
      backgroundColor: "white",
      frames: [
        {
          name: `Autorouter reference: ${drc.errors.length} errors`,
          graphics: {
            ...graphics,
            texts: [...(graphics.texts ?? []), ...measurements],
          },
        },
        {
          name: `Via-pad checker: ${viaPadErrors.length} errors`,
          graphics: {
            ...graphics,
            texts: [...(graphics.texts ?? []), ...measurements],
            circles: [
              ...(graphics.circles ?? []),
              ...viaPadErrors.map((error): Circle => {
                const center = error.center
                if (center?.x === undefined || center.y === undefined) {
                  throw new Error(
                    "Via-pad violations must retain their location",
                  )
                }
                return {
                  center: { x: center.x, y: center.y },
                  radius: 0.1,
                  stroke: "#b91c1c",
                  fill: "rgba(185, 28, 28, 0.12)",
                }
              }),
            ],
          },
        },
      ],
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

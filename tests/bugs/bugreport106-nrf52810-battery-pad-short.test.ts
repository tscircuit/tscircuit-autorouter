import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import after from "../../fixtures/bug-reports/bugreport106-nrf52810-battery-pad-short/after.json"
import before from "../../fixtures/bug-reports/bugreport106-nrf52810-battery-pad-short/before.json"
import inputJson from "../../fixtures/bug-reports/bugreport106-nrf52810-battery-pad-short/bugreport106-nrf52810-battery-pad-short.srj.json"

const input = inputJson as SimpleRouteJson

// Use the original declared connectivity, not nets inferred from routed copper.
const getSwdclkBatteryPadConflicts = (
  traces: SimplifiedPcbTrace[],
): string[] => {
  const connMap = getConnectivityMapFromSimpleRouteJson(input)
  const pad = input.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_58",
  )!
  const padZ = mapLayerNameToZ(pad.layers[0]!, input.layerCount)
  const conflicts: string[] = []
  for (const trace of traces) {
    if (!connMap.areIdsConnected(trace.connection_name, "source_net_3")) {
      continue
    }
    expect(
      pad.connectedTo.some((id) =>
        connMap.areIdsConnected(trace.connection_name, id),
      ),
    ).toBeFalse()
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type === "via") {
        const fromZ = mapLayerNameToZ(point.from_layer, input.layerCount)
        const toZ = mapLayerNameToZ(point.to_layer, input.layerCount)
        if (padZ < Math.min(fromZ, toZ) || padZ > Math.max(fromZ, toZ)) {
          continue
        }
        if (
          segmentToBoxMinDistance(point, point, pad) <
          (point.via_diameter ?? input.minViaDiameter!) / 2 + 0.1 - 1e-9
        ) {
          conflicts.push(`${trace.pcb_trace_id}:via:${index}`)
        }
      } else if (point.route_type === "wire") {
        const previous = trace.route[index - 1]
        if (
          previous?.route_type === "wire" &&
          previous.layer === point.layer &&
          mapLayerNameToZ(point.layer, input.layerCount) === padZ &&
          segmentToBoxMinDistance(previous, point, pad) <
            Math.max(previous.width, point.width) / 2 + 0.1 - 1e-9
        ) {
          conflicts.push(`${trace.pcb_trace_id}:wire:${index}`)
        }
      }
    }
  }
  return conflicts
}

test("bugreport106 routes the full nRF input without shorting SWDCLK into the battery pad", async (): Promise<void> => {
  expect(input.connections).toHaveLength(26)
  expect(input.obstacles).toHaveLength(117)
  expect(input.traces).toHaveLength(6)
  expect(before.inputSha256).toBe(
    createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  )
  expect(after.inputSha256).toBe(before.inputSha256)
  expect(
    getSwdclkBatteryPadConflicts(after.routedTraces as SimplifiedPcbTrace[]),
  ).toEqual([])
  const originalInput = structuredClone(input)
  const beforeTraces = before.routedTraces as SimplifiedPcbTrace[]
  expect(getSwdclkBatteryPadConflicts(beforeTraces).length).toBeGreaterThan(0)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: before.srjWithPointPairs as SimpleRouteJson,
      routedTraces: beforeTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "before" })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThan(50)
  expect(
    routedTraces.some((trace) => trace.connection_name === "source_net_3"),
  ).toBeTrue()
  expect(getSwdclkBatteryPadConflicts(routedTraces)).toEqual([])
  expect(input).toEqual(originalInput)

  // Keep the remaining board-wide DRC errors visible; do not assert DRC-clean.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "after" })
})

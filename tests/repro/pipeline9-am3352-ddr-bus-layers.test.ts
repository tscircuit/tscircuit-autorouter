import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLayerRoutingSolver } from "lib/solvers/BusLayerRoutingSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { assertBusAllowedLayers } from "../fixtures/assertBusAllowedLayers"
import { countConnectedAm3352Signals } from "../fixtures/countConnectedAm3352Signals"
import { getAm3352BusLayerSnapshot } from "../fixtures/getAm3352BusLayerSnapshot"

test("AM3352 DDR paths negotiate legal layers while retaining all real-board obstacles", async (): Promise<void> => {
  const raw = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL(
          "../fixtures/assets/am3352-ddr-layer-routing.json.gz",
          import.meta.url,
        ),
      ),
    ),
  )
  expect(createHash("sha256").update(Uint8Array.from(raw)).digest("hex")).toBe(
    "77daaa08193bd3b6156fa6558ac4d9bda6237ce844e6556b3f3e708e289026c3",
  )
  const { srj, routes } = JSON.parse(raw.toString("utf8")) as {
    srj: SimpleRouteJson
    routes: HighDensityRoute[]
  }
  const original = structuredClone({ srj, routes })
  expect(srj.obstacles).toHaveLength(907)
  expect(srj.connections).toHaveLength(47)
  expect(srj.layerCount).toBe(4)
  const solver = new BusLayerRoutingSolver({ srj, hdRoutes: routes })
  solver.solve()
  const output = solver.getOutput()
  const stage = "after" as const
  const traces: SimplifiedPcbTraces = output.map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `ddr-${stage}-${index}`,
    connection_name: route.rootConnectionName ?? route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
  }))
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
  })
  const illegalRouteCount = traces.filter((trace) => {
    try {
      assertBusAllowedLayers(srj, [trace])
      return false
    } catch {
      return true
    }
  }).length
  const connectedSignals = countConnectedAm3352Signals(srj, output)
  for (const zoom of [false, true]) {
    await expect(
      getAm3352BusLayerSnapshot({
        srj,
        traces,
        stage,
        illegalRouteCount,
        drcCount: drc.errors.length,
        connectedSignals,
        zoom,
      }),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: zoom ? "ddr-escape" : "full-board",
      tolerance: 0,
    })
  }
  expect(drc.errors).toHaveLength(0)
  expect(connectedSignals).toBe(47)
  expect(illegalRouteCount).toBe(0)
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.busLayerViolationsBefore).toBe(20)
  expect(solver.stats.accepted).toBe(true)
  expect(solver.stats.unresolvedSpanCount).toBe(0)
  expect({ srj, routes }).toEqual(original)
  expect(output.map((route) => [route.route[0], route.route.at(-1)])).toEqual(
    routes.map((route) => [route.route[0], route.route.at(-1)]),
  )
})

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

type GliderRepairContext = {
  params: Omit<Pipeline9HighDensitySolverParams, "connMap"> & {
    connMap: ConstructorParameters<typeof ConnectivityMap>[0]
  }
  completedRoutes: HighDensityRoute[]
}

test("Glider regional copper cuts beside the source_net_184 crossing", async (): Promise<void> => {
  const fixture: GliderRepairContext = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(`${import.meta.dir}/glider-repair-context.json.gz`),
      ),
    ).toString(),
  )
  const srj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(`${import.meta.dir}/glider-routing-input.json.gz`),
      ),
    ).toString(),
  )
  const circuitJson: AnyCircuitElement[] = JSON.parse(
    gunzipSync(
      new Uint8Array(readFileSync(`${import.meta.dir}/glider.circuit.json.gz`)),
    ).toString(),
  )
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.params.connMap),
  })
  solver.routes.push(...fixture.completedRoutes)
  solver.solve()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("Unrelated route terminals overlap")
  expect(solver.routes).toHaveLength(fixture.completedRoutes.length)

  const originalTraceIds = new Set(
    srj.traces!.map((trace) => trace.pcb_trace_id),
  )
  const traces: SimplifiedPcbTrace[] = [
    ...solver.getUpdatedFixedHdRoutes(),
    ...solver.routes,
  ].map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `glider_repair_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, {
      defaultViaHoleDiameter: srj.minViaHoleDiameter,
    }),
  }))
  const copper = convertToCircuitJson(srj, traces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const circuit = [
    ...circuitJson.filter((element) => {
      if (element.type === "pcb_trace")
        return !originalTraceIds.has(element.pcb_trace_id)
      if (element.type === "pcb_via")
        return !originalTraceIds.has(element.pcb_trace_id!)
      return true
    }),
    ...copper,
  ]
  const options = {
    backgroundColor: "white",
    shouldDrawErrors: false,
    showErrorsInTextOverlay: false,
    shouldDrawRatsNest: false,
    showSolderMask: false,
    includeVersion: false,
    width: 1000,
    height: 1000,
  }
  await expect(convertCircuitJsonToPcbSvg(circuit, options)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "full-circuit", scale: 1 },
  )
  const bounds = { minX: -11.2, maxX: -8.5, minY: -13.35, maxY: -10.65 }
  const focusedCircuit = circuit
    .filter((element) => {
      if (element.type === "pcb_board") return true
      if (element.type === "pcb_trace") {
        const points = element.route.filter((point) => "x" in point)
        return (
          Math.min(...points.map((point) => point.x)) <= bounds.maxX &&
          Math.max(...points.map((point) => point.x)) >= bounds.minX &&
          Math.min(...points.map((point) => point.y)) <= bounds.maxY &&
          Math.max(...points.map((point) => point.y)) >= bounds.minY
        )
      }
      const center = "center" in element ? element.center : element
      if (!center || !("x" in center) || !("y" in center))
        return !element.type.startsWith("pcb_")
      return (
        typeof center.x === "number" &&
        typeof center.y === "number" &&
        center.x >= bounds.minX &&
        center.x <= bounds.maxX &&
        center.y >= bounds.minY &&
        center.y <= bounds.maxY
      )
    })
    .map(
      (element): AnyCircuitElement =>
        element.type === "pcb_board"
          ? {
              ...element,
              center: { x: -9.85, y: -12 },
              width: 2.7,
              height: 2.7,
              outline: undefined,
            }
          : element,
    )
  await expect(
    convertCircuitJsonToPcbSvg(focusedCircuit, {
      ...options,
      drawPaddingOutsideBoard: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "repair", scale: 1 })
})

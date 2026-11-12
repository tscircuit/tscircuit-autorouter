import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getH616SvrefCircuitSnapshots } from "tests/fixtures/getH616SvrefCircuitSnapshots"

test("connects H616 C3 to U2 SVREF on the full reference PCB", async (): Promise<void> => {
  // Original placement and netlist from Kononenko-K/Allwinner_H616_Devboard,
  // commit 94fe1071ff3d7c2e6a227a3e4dfccb6acae305c4. All 125 components and
  // 264 nets remain present; the SRJ starts after DDR routing, before other nets.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-round-pad-full-circuit.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  pipeline.solve()
  // The board is not yet fully routed. Inspect the accepted SVREF route,
  // rather than treating this partial routing stage as a solved board.
  expect(pipeline.failed).toBeTrue()
  expect(
    pipeline.portPointPathingSolver!.getOutput().changedPreloadedTraceSections,
  ).toEqual([])
  const svrefTrace = fixture.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SVREF",
  )!
  if (svrefTrace.type !== "source_trace") throw new Error("Missing SVREF trace")
  const svrefNetId = svrefTrace.connected_source_net_ids![0]!
  const connections = pipeline.srjWithPointPairs!.connections.filter(
    (connection) => connection.__rootConnectionNames?.includes(svrefNetId),
  )
  const c3 = fixture.circuitJson.find(
    (element) => element.type === "source_component" && element.name === "C3",
  )!
  if (c3.type !== "source_component") throw new Error("Missing C3")
  const c3Component = fixture.circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === c3.source_component_id,
  )!
  if (c3Component.type !== "pcb_component") throw new Error("Missing C3 PCB")
  const c3Connection = connections.find((connection) =>
    connection.pointsToConnect.some((point) =>
      fixture.circuitJson.some(
        (element) =>
          element.type === "pcb_port" &&
          element.pcb_component_id === c3Component.pcb_component_id &&
          element.pcb_port_id === point.pcb_port_id,
      ),
    ),
  )!
  // Other SVREF branches are incomplete when the board router stops. Stitch
  // the C3 branch checked here; the complete stitch replay has its own test.
  const stitch = new MultipleHighDensityRouteStitchSolver3({
    connections,
    hdRoutes: pipeline.highDensityRouteSolver!.routes.filter(
      (route) => route.connectionName === c3Connection.name,
    ),
    layerCount: fixture.srj.layerCount,
    defaultViaDiameter: pipeline.viaDiameter,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  stitch.solve()
  expect(stitch.solved).toBeTrue()
  expect(stitch.failed).toBeFalse()
  const c3Route = stitch.mergedHdRoutes.find(
    (route) => route.connectionName === c3Connection.name,
  )!
  const endpoints = [c3Route.route[0]!, c3Route.route.at(-1)!]
  const connectsBothTerminals = c3Connection.pointsToConnect.every((terminal) =>
    endpoints.some(
      (point) =>
        Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6 &&
        point.z === mapLayerNameToZ(terminal.layer!, fixture.srj.layerCount),
    ),
  )
  expect(connectsBothTerminals).toBeTrue()
  const snapshots = getH616SvrefCircuitSnapshots({
    circuitJson: fixture.circuitJson,
    originalSrj: pipeline.originalSrj,
    srjWithPointPairs: pipeline.srjWithPointPairs!,
    preloadedRoutes: pipeline.highDensityRouteSolver!.getUpdatedFixedHdRoutes(),
    hdRoutes: pipeline.highDensityRouteSolver!.routes,
    svrefTrace,
  })
  await expect(snapshots.board).toMatchSvgSnapshot(import.meta.path, {
    scale: 1,
  })
  await expect(snapshots.svref).toMatchSvgSnapshot(import.meta.path, {
    svgName: "svref",
    scale: 1,
  })
})

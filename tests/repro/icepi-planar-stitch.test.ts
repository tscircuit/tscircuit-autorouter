import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { getPipeline9NetByConnectionName } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9NetByConnectionName"
import { getTerminalLayerIndicesByPcbPortId } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getTerminalLayerIndicesByPcbPortId"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getIcepiCpuxStitchSnapshotSvg } from "tests/fixtures/getIcepiCpuxStitchSnapshotSvg"
import fixture from "./assets/icepi-cpux-stitch.json"

test("captures the iCE/Pi CPUX crop through stitching and simplification", async (): Promise<void> => {
  // Captured router 0.0.1117 fragments, before stitching (run 44051672939).
  // Board-space points use millimeters, +X right and +Y up. Only terminal
  // identifiers are renamed; the fragment and pad geometry stays unchanged.
  // Run the production simplifier only after stitching succeeds, as Pipeline 9
  // does. This 32-pad crop stops before whole-board joint DRC repair.
  const input = fixture.srj as SimpleRouteJson
  const hdRoutes = fixture.stitch.hdRoutes as HighDensityIntraNodeRoute[]
  const solver = new SingleHighDensityRouteStitchSolver3({
    ...fixture.stitch,
    hdRoutes,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "prefer_clear",
  })
  solver.solve()
  expect(fixture.stitch.hdRoutes).toHaveLength(24)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("PCB terminal layers")

  const plannedVias = hdRoutes.flatMap((fragment) => fragment.vias)
  for (const segment of convertHdRouteToSimplifiedRoute(
    solver.mergedHdRoute,
    input.layerCount,
  )) {
    if (segment.route_type !== "via") continue
    expect(plannedVias).toContainEqual({ x: segment.x, y: segment.y })
  }

  let route = solver.mergedHdRoute
  if (solver.solved) {
    const connMap = getConnectivityMapFromSimpleRouteJson(input)
    const canonicalRoutes = canonicalizePipeline9HdRoutes([route])
    const simplifier = new TraceSimplificationSolver({
      hdRoutes: canonicalRoutes,
      obstacles: input.obstacles,
      connMap,
      colorMap: {},
      outline: input.outline,
      defaultViaDiameter: route.viaDiameter,
      layerCount: input.layerCount,
      minTraceToPadEdgeClearance: input.minTraceToPadEdgeClearance,
      minBoardEdgeClearance: input.minBoardEdgeClearance,
      otherHdRoutes: [],
      netByConnectionName: getPipeline9NetByConnectionName(
        canonicalRoutes,
        connMap,
      ),
      enableCrossingViaReduction: true,
      terminalLayerIndicesByPcbPortId: getTerminalLayerIndicesByPcbPortId(
        input.connections,
        input.obstacles,
        input.layerCount,
      ),
    })
    simplifier.solve()
    expect(simplifier.solved).toBe(true)
    expect(simplifier.failed).toBe(false)
    expect(simplifier.simplifiedHdRoutes).toHaveLength(1)
    route = simplifier.simplifiedHdRoutes[0]!
    expect(route.startPcbPortId).toBe(solver.start.pcb_port_id)
    expect(route.endPcbPortId).toBe(solver.end.pcb_port_id)
  }
  const reachedTerminals = [
    { terminal: solver.start, endpoint: route.route[0]! },
    { terminal: solver.end, endpoint: route.route.at(-1)! },
  ].filter(
    ({ terminal, endpoint }) =>
      terminal.z === endpoint.z &&
      Math.hypot(terminal.x - endpoint.x, terminal.y - endpoint.y) < 0.001,
  ).length
  expect(reachedTerminals).toBe(1)

  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "cpux-stitch",
    connection_name: "CPUX",
    route: convertHdRouteToSimplifiedRoute(route, input.layerCount),
  }
  const vias = trace.route.filter((segment) => segment.route_type === "via")
  const viaSites = new Set(vias.map((segment) => getXyPointKey(segment)))
  expect(vias).toHaveLength(3)
  expect(viaSites.size).toBe(3)
  await expect(
    getIcepiCpuxStitchSnapshotSvg({
      input,
      trace,
      reachedTerminals,
      viaSiteCount: viaSites.size,
      stage: solver.solved ? "simplification" : "stitching",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

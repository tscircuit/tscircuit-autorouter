import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import {
  AutoroutingDrcEngine,
  TraceContactRepairSolver,
} from "high-density-repair03/lib"
import type { TraceContactRepairSolverParams } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/TraceContactRepairSolver"
import { TraceContactGuard } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("checks pad drills after restoring H616 DDR connections", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/h616-restored-pad-drill.json.gz",
    import.meta.url,
  )
  const fixture = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as TraceContactRepairSolverParams & { netMap: Record<string, string[]> }
  const connMap = new ConnectivityMap(fixture.netMap)
  const engine = new AutoroutingDrcEngine(fixture.srj, {
    connMap,
    traceClearance: 0.1,
    viaToPadClearance: 0.1,
    viaClearance: 0.1,
  })
  const solver = new TraceContactRepairSolver({
    ...fixture,
    connMap,
    autoroutingDrcEngine: engine,
  })
  solver.solve()
  const output = solver.getOutput()
  const snapshot = getDrcSnapshot(
    fixture.srj,
    output,
    undefined,
    connMap,
    engine,
  )
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output).toHaveLength(fixture.inputHdRoutes.length)
  const guard = new TraceContactGuard({
    srj: fixture.srj,
    inputRoutes: fixture.inputHdRoutes,
    connMap,
  })
  expect(guard.getNewContactPairs(output)).toEqual([])
  for (const route of output) {
    const input = fixture.inputHdRoutes.find(
      (input) => input.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(input.route[0])
    expect(route.route.at(-1)).toEqual(input.route.at(-1))
  }
  const drills = snapshot.errors.filter(
    (error) => error.type === "pcb_placement_error",
  )
  expect(drills).toEqual([])
  const traces: SimplifiedPcbTrace[] = output.map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `${route.connectionName}_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, fixture.srj.layerCount, {
      defaultViaHoleDiameter: fixture.srj.minViaHoleDiameter,
    }),
  }))
  const board = convertSrjToGraphicsObject({ ...fixture.srj, traces })
  board.points = []
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([board], {
        titles: [`H616 DDR | Forbidden pad drills: ${drills.length}`],
      }),
      { backgroundColor: "white", svgWidth: 1200, svgHeight: 1200 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

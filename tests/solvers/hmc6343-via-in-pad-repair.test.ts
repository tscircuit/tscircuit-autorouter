import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("repair moves the HMC6343 drill out of its own solder-jumper pad", () => {
  // Reduced reproduction of the failing route captured from sparkfun-boards #379.
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    connections: [{
      name: "power",
      pointsToConnect: [
        { x: 7, y: 0.975, layer: "top", pcb_port_id: "start", pointId: "start" },
        { x: 6.155, y: -1.2635, layer: "top", pcb_port_id: "end", pointId: "end" },
      ],
    }],
    obstacles: [
      { type: "rect", center: { x: 7, y: 0.975 }, width: 0.95, height: 0.8,
        layers: ["top"], connectedTo: ["power", "start", "pcb_smtpad_start"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_start", pcb_port_id: "start" } },
      { type: "rect", center: { x: 6.155, y: -1.2635 }, width: 1.27, height: 0.635,
        layers: ["top"], connectedTo: ["power", "end", "pcb_smtpad_end"],
        circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_end", pcb_port_id: "end" } },
    ],
  } satisfies SimpleRouteJson
  const route: HighDensityRoute = {
    connectionName: "power",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 7, y: 0.975, z: 0, pcb_port_id: "start" },
      { x: 6.536196322489303, y: 1.5776291015540003, z: 0 },
      { x: 6.536196322489303, y: 1.5776291015540003, z: 1 },
      { x: 7.565315227667777, y: 1.1891522309371534, z: 1 },
      { x: 6.649683069373805, y: -1.236460297277114, z: 1 },
      { x: 6.369014277052403, y: -1.1305120598361558, z: 1 },
      { x: 6.369014277052403, y: -1.1305120598361558, z: 0 },
      { x: 6.155, y: -1.2635, z: 0, pcb_port_id: "end" },
    ],
    vias: [
      { x: 6.536196322489303, y: 1.5776291015540003 },
      { x: 6.369014277052403, y: -1.1305120598361558 },
    ],
  }
  const conversionOptions = {
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.2,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    originalSrj: srj,
    srjWithPointPairs: srj,
  }
  const convert = (routes: HighDensityRoute[]): AnyCircuitElement[] => {
    return convertToCircuitJson(
      srj,
      convertPipeline7HdRoutesToSimplifiedPcbTraces({ ...conversionOptions, hdRoutes: routes }),
      { originalSrj: srj, includeOriginalConnections: true },
    )
  }
  expect(checkViasInPads(convert([route]))).toHaveLength(1)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: [route],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: conversionOptions.connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.2,
    effort: 1,
    colorMap: { power: "red" },
  })
  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  solver.solve()
  expect(checkViasInPads(convert(solver.getOutput()))).toEqual([])
  expect(getDrcErrors(convert(solver.getOutput())).errors).toEqual([])
  expect(solver.getOutput()[0]?.route[0]).toMatchObject({ x: 7, y: 0.975, z: 0, pcb_port_id: "start" })
  expect(solver.getOutput()[0]?.route.at(-1)).toMatchObject({ x: 6.155, y: -1.2635, z: 0, pcb_port_id: "end" })
})

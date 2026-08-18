import { expect, test } from "bun:test"
import { sample003 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 preserves a materialized through-obstacle fanout trace", () => {
  const inputSrj = structuredClone(sample003) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })
  while (
    !solver.failed &&
    !solver.autoroutingPipelineSolver?.autoroutingPipelineSolver
      ?.pipeline9JointDrcRepairSolver
  ) {
    solver.step()
  }

  const pipeline9 = solver.autoroutingPipelineSolver?.autoroutingPipelineSolver
  if (!pipeline9?.srjWithPointPairs) {
    throw new Error("Expected Pipeline9 to reach joint DRC repair")
  }
  const jointDrcRepair = pipeline9.pipeline9JointDrcRepairSolver
  if (!jointDrcRepair) {
    throw new Error("Expected Pipeline9 to construct joint DRC repair")
  }
  expect(solver.failed).toBe(false)
  const movableSectionsFromThroughObstacleTraces =
    jointDrcRepair.movablePreloadedSections.filter((section) =>
      section.originalTrace.route.some(
        (routePoint) => routePoint.route_type === "through_obstacle",
      ),
    )
  expect(movableSectionsFromThroughObstacleTraces.length).toBeGreaterThan(0)
  expect(
    movableSectionsFromThroughObstacleTraces.every((section) =>
      section.originalTrace.route.every(
        (routePoint, routePosition) =>
          routePoint.route_type !== "through_obstacle" ||
          routePosition < section.originalRoutePositionStart ||
          routePosition > section.originalRoutePositionEnd,
      ),
    ),
  ).toBe(true)

  const routedBoardTraces = [
    ...jointDrcRepair.getUpdatedPreloadedTraces(),
    ...convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: jointDrcRepair.params.newConnections,
      originalConnections: inputSrj.connections,
      hdRoutes: jointDrcRepair.getOutput(),
      layerCount: inputSrj.layerCount,
      obstacles: inputSrj.obstacles,
      defaultViaHoleDiameter: jointDrcRepair.params.defaultViaHoleDiameter,
      connMap: jointDrcRepair.params.connMap,
    }),
  ]
  expect(
    routedBoardTraces.some((trace) =>
      trace.route.some(
        (routePoint) => routePoint.route_type === "through_obstacle",
      ),
    ),
  ).toBe(true)

  const circuitJson = convertToCircuitJson(
    pipeline9.srjWithPointPairs,
    routedBoardTraces,
    {
      minTraceWidth: inputSrj.minTraceWidth,
      minViaDiameter: inputSrj.minViaDiameter,
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    },
  )
  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "#0f172a",
    matchBoardAspectRatio: true,
  })

  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

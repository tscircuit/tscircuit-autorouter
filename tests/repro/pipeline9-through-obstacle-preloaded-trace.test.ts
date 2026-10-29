import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import capturedSample003JointRepair from "./assets/pipeline9-through-obstacle-sample003.json" with {
  type: "json",
}

type JointRepairParams = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]

type CapturedJointRepair = Omit<
  JointRepairParams,
  "srjWithPointPairs" | "mutatedPreloadedTraceIds" | "connMap" | "obstacles"
> & {
  sourceDataset: string
  mutatedPreloadedTraceIds: string[]
}

test("Pipeline9 preserves a materialized through-obstacle fanout trace", () => {
  const captured = structuredClone(
    capturedSample003JointRepair,
  ) as unknown as CapturedJointRepair
  const {
    sourceDataset: _,
    mutatedPreloadedTraceIds,
    ...capturedParams
  } = captured
  const params: JointRepairParams = {
    ...capturedParams,
    srjWithPointPairs: capturedParams.srj,
    obstacles: capturedParams.srj.obstacles,
    mutatedPreloadedTraceIds: new Set(mutatedPreloadedTraceIds),
    connMap: getConnectivityMapFromSimpleRouteJson(capturedParams.originalSrj),
  }
  const jointDrcRepair = new Pipeline9JointDrcRepairSolver(params)

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
      originalConnections: params.originalSrj.connections,
      hdRoutes: jointDrcRepair.getOutput(),
      layerCount: params.layerCount,
      obstacles: params.obstacles,
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
    params.srjWithPointPairs,
    routedBoardTraces,
    {
      minTraceWidth: params.originalSrj.minTraceWidth,
      minViaDiameter: params.originalSrj.minViaDiameter,
      originalSrj: params.originalSrj,
      includeOriginalConnections: true,
    },
  )
  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "#0f172a",
    matchBoardAspectRatio: true,
  })

  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
})

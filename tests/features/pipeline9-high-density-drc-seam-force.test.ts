import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensitySeamForceCandidates,
  type Pipeline9HighDensitySeamForceCandidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensitySeamForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"

test("Pipeline9 seam forces move both handoffs without changing fixed copper", (): void => {
  const seam: PortPoint = {
    portPointId: "seam-A",
    connectionName: "A",
    x: 0,
    y: 0,
    z: 0,
  }
  const nodes: NodeWithPortPoints[] = [-1, 1].map((side) => {
    const outer: PortPoint = {
      portPointId: `outer-${side}`,
      pcb_port_id: `port-${side}`,
      connectionName: "A",
      x: side * 2,
      y: 0,
      z: 0,
    }
    return {
      capacityMeshNodeId: side < 0 ? "L" : "R",
      center: { x: side, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0, 1],
      portPoints: [outer, { ...seam }],
      portPointsInPairs: [[outer, { ...seam }]],
    }
  })
  const routes: HighDensityRoute[] = [-1, 1].map((side) => ({
    connectionName: "A",
    rootConnectionName: "A",
    regionId: side < 0 ? "L" : "R",
    startPcbPortId: `port-${side}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [2, 0.5, 0].map((x) => ({ x: side * x, y: 0, z: 0 })),
    vias: [],
  }))
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed-copper",
    connection_name: "C",
    route: [
      { route_type: "wire", x: -2, y: 1.5, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 1.5, layer: "top", width: 0.1 },
    ],
  }
  const connMap = new ConnectivityMap({
    A: ["A", "port--1", "port-1"],
    B: ["B", "pad-b"],
    C: ["C", "fixed-copper"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.27 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad-b" },
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [-1, 1].map((side) => ({
          x: side * 2,
          y: 0,
          layer: "top",
          pcb_port_id: `port-${side}`,
        })),
      },
    ],
    traces: [fixedTrace],
  }
  const fixedHdRoutes = convertPreloadedTraceToHdRoutes(
    fixedTrace,
    0,
    2,
    0.3,
    connMap,
  )
  const originalInputs = structuredClone({ routes, nodes, fixedHdRoutes, srj })
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    originalFixedHdRoutes: fixedHdRoutes,
    fixedHdRoutes,
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    hdRoutes: routes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const initialErrors = getPipeline9DrcErrors(evaluator, routes)
  expect(initialErrors.length).toBeGreaterThan(0)
  const leftPadError = initialErrors.find(
    (error) =>
      error.type === "pcb_pad_trace_clearance_error" &&
      error.pcb_trace_id === "A_0",
  )
  expect(leftPadError).toMatchObject({
    center: { x: -1, y: 0 },
    __pad_centers: [{ x: 0, y: 0.27 }],
  })
  const originalErrors = structuredClone(initialErrors)
  let improved: Pipeline9HighDensitySeamForceCandidate | undefined
  const rejections: Record<string, number> = {}
  const candidateEvaluations: Array<{
    seam: Pipeline9HighDensitySeamForceCandidate["seam"]
    errors: ReturnType<typeof getPipeline9DrcErrors>
  }> = []
  for (const candidate of getPipeline9HighDensitySeamForceCandidates({
    affectedRouteIndex: 0,
    nodePortPoints: nodes,
    hdRoutes: routes,
    fixedHdRoutes,
    errors: initialErrors,
    traceRouteIndexById: new Map([
      ["A_0", 0],
      ["A_1", 1],
    ]),
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    effort: 1,
    onCandidateRejected: (reason): void => {
      rejections[reason] = (rejections[reason] ?? 0) + 1
    },
  })) {
    const candidateRoutes = [...routes]
    for (const replacement of candidate.replacements) {
      candidateRoutes[replacement.routeIndex] = replacement.route
    }
    const errors = getPipeline9DrcErrors(evaluator, candidateRoutes)
    candidateEvaluations.push({ seam: candidate.seam, errors })
    if (isPipeline9HighDensityDrcCandidateBetter(errors, initialErrors)) {
      improved = candidate
      break
    }
  }
  if (!improved) {
    console.log("Pipeline9 seam force candidate diagnostics", {
      initialErrors,
      rejections,
      yieldedCandidateCount: candidateEvaluations.length,
      candidateEvaluations,
    })
  }
  expect(improved).toBeDefined()
  expect(improved!.seam.portPointId).toBe("seam-A")
  expect(improved!.seam.ownerNodeIds).toEqual(["L", "R"])
  expect(improved!.seam.x).toBe(0)
  expect(improved!.seam.y).not.toBe(0)
  expect(improved!.replacements.map((entry) => entry.routeIndex)).toEqual([
    0, 1,
  ])
  const [left, right] = improved!.replacements.map((entry) => entry.route)
  expect(left!.route.at(-1)).toEqual(right!.route.at(-1))
  for (const [index, replacement] of improved!.replacements.entries()) {
    expect(replacement.route.route[0]).toEqual(routes[index]!.route[0])
    expect(replacement.route.regionId).toBe(routes[index]!.regionId)
    expect(replacement.route.startPcbPortId).toBe(routes[index]!.startPcbPortId)
  }
  expect({ routes, nodes, fixedHdRoutes, srj }).toEqual(originalInputs)
  expect(initialErrors).toEqual(originalErrors)
})

import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensitySeamForceCandidates,
  type Pipeline9HighDensitySeamForceCandidate,
  type Pipeline9HighDensitySeamForceCandidateParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensitySeamForceCandidates"
import { isPipeline9HighDensityRouteInsideBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityRouteInsideBounds"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"

test("Pipeline9 repairs rounded structural seams without merging nearby branches", (): void => {
  const cases = [
    {
      name: "Repair01 rounded seam",
      seamX: 0.1234,
      leftX: 0.123,
      outerY: 0,
      topologyOuterY: 0,
      centerY: 0,
    },
    {
      name: "mixed exact and Repair01 rounded seam",
      seamX: 0.1234,
      leftX: 0.1234,
      outerY: 0,
      topologyOuterY: 0,
      centerY: 0,
    },
    {
      name: "raw boundary arithmetic and unchanged rounded outer anchors",
      seamX: 0.1,
      leftX: 0.1,
      outerY: 0.23,
      topologyOuterY: 0.22999999999999998,
      centerY: -1.77,
    },
  ]
  for (const entry of cases) {
    const roundedSeamX = Math.round(entry.seamX * 1_000) / 1_000
    const seam: PortPoint = {
      portPointId: "shared-A",
      connectionName: "A",
      x: entry.seamX,
      y: 0,
      z: 0,
    }
    const nodes: NodeWithPortPoints[] = [-1, 1].map((side) => {
      const outer: PortPoint = {
        portPointId: `outer-${side}`,
        pcb_port_id: `port-${side}`,
        connectionName: "A",
        x: entry.seamX + side * 1.5,
        y: entry.topologyOuterY,
        z: 0,
      }
      return {
        capacityMeshNodeId: side < 0 ? "L" : "R",
        center: { x: entry.seamX + side, y: entry.centerY },
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
      route: [
        { x: entry.seamX + side * 1.5, y: entry.outerY, z: 0 },
        { x: entry.seamX + side * 0.5, y: 0, z: 0 },
        { x: side < 0 ? entry.leftX : roundedSeamX, y: 0, z: 0 },
      ],
      vias: [],
    }))
    const connMap = new ConnectivityMap({
      A: ["A", "port--1", "port-1"],
      B: ["B", "pad-b"],
    })
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [
        {
          type: "rect",
          center: { x: entry.seamX, y: 0.27 },
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
            x: entry.seamX + side * 1.5,
            y: entry.topologyOuterY,
            layer: "top",
            pcb_port_id: `port-${side}`,
          })),
        },
      ],
    }
    const original = structuredClone({ routes, nodes, srj })
    const evaluator = createPipeline9HighDensityDrcEvaluator({
      connections: srj.connections,
      originalConnections: srj.connections,
      originalFixedHdRoutes: [],
      fixedHdRoutes: [],
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
    expect(initialErrors.length, entry.name).toBeGreaterThan(0)
    const rejections: Record<string, number> = {}
    const params: Pipeline9HighDensitySeamForceCandidateParams = {
      affectedRouteIndex: 0,
      nodePortPoints: nodes,
      hdRoutes: routes,
      forceContext: evaluator.getForceContext(routes),
      fixedHdRoutes: [],
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
    }
    let repaired: Pipeline9HighDensitySeamForceCandidate | undefined
    let candidateCount = 0
    for (const candidate of getPipeline9HighDensitySeamForceCandidates(
      params,
    )) {
      candidateCount++
      const candidateRoutes = [...routes]
      for (const replacement of candidate.replacements) {
        candidateRoutes[replacement.routeIndex] = replacement.route
      }
      if (getPipeline9DrcErrors(evaluator, candidateRoutes).length === 0) {
        repaired = candidate
        break
      }
    }
    if (!repaired) {
      console.info({ entry, initialErrors, candidateCount, rejections })
    }
    expect(repaired, entry.name).toBeDefined()
    expect(repaired!.seam.x).toBe(entry.seamX)
    expect(repaired!.seam.y).not.toBe(0)
    expect(repaired!.replacements[0].route.route.at(-1)).toEqual(
      repaired!.replacements[1].route.route.at(-1),
    )
    for (const replacement of repaired!.replacements) {
      const node = nodes[replacement.routeIndex]!
      expect(
        isPipeline9HighDensityRouteInsideBounds(
          replacement.route,
          getBoundsFromNodeWithPortPoints(node),
          2,
          { originalRoute: routes[replacement.routeIndex]!, node },
        ),
      ).toBeTrue()
      expect(replacement.route.route[0]).toEqual(
        routes[replacement.routeIndex]!.route[0],
      )
    }
    const ambiguousPort: PortPoint = {
      ...seam,
      portPointId: "other-branch",
      x: entry.seamX + 0.00001,
    }
    expect(
      [
        ...getPipeline9HighDensitySeamForceCandidates({
          ...params,
          nodePortPoints: [
            {
              ...nodes[0]!,
              portPoints: [...nodes[0]!.portPoints, ambiguousPort],
            },
            nodes[1]!,
          ],
        }),
      ],
      `${entry.name}: ambiguous structural identity`,
    ).toEqual([])
    expect(
      [
        ...getPipeline9HighDensitySeamForceCandidates({
          ...params,
          hdRoutes: [
            ...routes,
            {
              ...routes[0]!,
              connectionName: "other-branch",
              route: [ambiguousPort, { x: -1, y: 1, z: 0 }],
            },
          ],
        }),
      ],
      `${entry.name}: unmatched nearby route endpoint`,
    ).toEqual([])
    expect({ routes, nodes, srj }).toEqual(original)
  }
})

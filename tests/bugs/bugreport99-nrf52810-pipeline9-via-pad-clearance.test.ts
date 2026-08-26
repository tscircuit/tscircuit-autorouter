import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import srjJson from "../../fixtures/bug-reports/bugreport99-nrf52810-drc-identity-swap/bugreport99-nrf52810-drc-identity-swap.srj.json" with {
  type: "json",
}
import {
  type GraphicsSvgFrame,
  getGraphicsSvgFrames,
} from "../fixtures/solver-svg-frames"

type CircuitVia = Extract<AnyCircuitElement, { type: "pcb_via" }> & {
  pcb_trace_id?: string
}

type ViaPadViolation = {
  actualClearance: number
  center: { x: number; y: number }
  componentId: string
  ownerTraceId: string
  padId: string
  portName: string
}

type FocusBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type ViaPadMarker = {
  center: { x: number; y: number }
  padId: string
}

const srj = srjJson as SimpleRouteJson
const requiredViaPadClearance = srj.minViaEdgeToPadEdgeClearance ?? 0.1
const roundMetric = (value: number): number => Math.round(value * 1e9) / 1e9

const HOTSPOTS = [
  {
    name: "BT1 / VBAT_N",
    padId: "pcb_smtpad_58",
    ownerTraceIds: ["source_net_3_mst1_0"],
    bounds: { minX: 5.2, maxX: 9.3, minY: -2.5, maxY: 1.6 },
  },
  {
    name: "L2 / pin2",
    padId: "pcb_smtpad_105",
    ownerTraceIds: ["source_net_1_mst14_0"],
    bounds: { minX: 8.6, maxX: 10.6, minY: 2.3, maxY: 4.3 },
  },
  {
    name: "C1 / pin1",
    padId: "pcb_smtpad_90",
    ownerTraceIds: ["source_net_0_mst7_0", "source_net_0_mst8_0"],
    bounds: { minX: 0.2, maxX: 2.4, minY: 10.1, maxY: 12.3 },
  },
] as const

const clipSegmentToBounds = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: FocusBounds,
): [{ x: number; y: number }, { x: number; y: number }] | null => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let minT = 0
  let maxT = 1

  for (const [direction, distance] of [
    [-dx, start.x - bounds.minX],
    [dx, bounds.maxX - start.x],
    [-dy, start.y - bounds.minY],
    [dy, bounds.maxY - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return null
      continue
    }

    const ratio = distance / direction
    if (direction < 0) {
      if (ratio > maxT) return null
      minT = Math.max(minT, ratio)
    } else {
      if (ratio < minT) return null
      maxT = Math.min(maxT, ratio)
    }
  }

  return [
    {
      x: roundMetric(start.x + minT * dx),
      y: roundMetric(start.y + minT * dy),
    },
    {
      x: roundMetric(start.x + maxT * dx),
      y: roundMetric(start.y + maxT * dy),
    },
  ]
}

const pointIsInBounds = (
  point: { x: number; y: number },
  bounds: FocusBounds,
): boolean =>
  point.x >= bounds.minX &&
  point.x <= bounds.maxX &&
  point.y >= bounds.minY &&
  point.y <= bounds.maxY

const clipGraphicsLines = (
  lines: NonNullable<GraphicsObject["lines"]>,
  bounds: FocusBounds,
): NonNullable<GraphicsObject["lines"]> =>
  lines.flatMap((line) =>
    line.points.slice(0, -1).flatMap((start, pointIndex) => {
      const points = clipSegmentToBounds(
        start,
        line.points[pointIndex + 1]!,
        bounds,
      )
      return points ? [{ ...line, points }] : []
    }),
  )

const getClippedRect = (
  center: { x: number; y: number },
  width: number,
  height: number,
  bounds: FocusBounds,
) => {
  const minX = Math.max(bounds.minX, center.x - width / 2)
  const maxX = Math.min(bounds.maxX, center.x + width / 2)
  const minY = Math.max(bounds.minY, center.y - height / 2)
  const maxY = Math.min(bounds.maxY, center.y + height / 2)

  if (minX >= maxX || minY >= maxY) return null

  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
  }
}

const getClippedRectOutline = ({
  center,
  width,
  height,
  bounds,
  strokeColor,
}: {
  center: { x: number; y: number }
  width: number
  height: number
  bounds: FocusBounds
  strokeColor: string
}): NonNullable<GraphicsObject["lines"]> => {
  const minX = center.x - width / 2
  const maxX = center.x + width / 2
  const minY = center.y - height / 2
  const maxY = center.y + height / 2
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]

  return corners.flatMap((start, cornerIndex) => {
    const points = clipSegmentToBounds(
      start,
      corners[(cornerIndex + 1) % corners.length]!,
      bounds,
    )
    return points ? [{ points, strokeColor, strokeWidth: 0.025 }] : []
  })
}

const getHotspotFrames = ({
  outputSrj,
  violations,
  markers,
}: {
  outputSrj: SimpleRouteJson
  violations: ViaPadViolation[]
  markers: ViaPadMarker[]
}): GraphicsSvgFrame[] =>
  HOTSPOTS.map((hotspot) => {
    const ownerTraceIds = new Set<string>(hotspot.ownerTraceIds)
    const traces = (outputSrj.traces ?? []).filter((trace) =>
      ownerTraceIds.has(trace.pcb_trace_id),
    )
    const foundOwnerIds = new Set(traces.map((trace) => trace.pcb_trace_id))
    const missingOwnerIds = [...ownerTraceIds].filter(
      (ownerTraceId) => !foundOwnerIds.has(ownerTraceId),
    )
    if (missingOwnerIds.length > 0) {
      throw new Error(
        `${hotspot.name} is missing output traces: ${missingOwnerIds.join(", ")}`,
      )
    }

    const matchingObstacles = outputSrj.obstacles.filter(
      (obstacle) =>
        obstacle.circuitJsonMetadata?.pcb_smtpad_id === hotspot.padId,
    )
    if (matchingObstacles.length !== 1) {
      throw new Error(
        `${hotspot.name} expected one ${hotspot.padId} obstacle, got ${matchingObstacles.length}`,
      )
    }
    const obstacle = matchingObstacles[0]!
    if ((obstacle.ccwRotationDegrees ?? 0) !== 0) {
      throw new Error(`${hotspot.name} requires an unrotated target pad`)
    }
    const clippedPad = getClippedRect(
      obstacle.center,
      obstacle.width,
      obstacle.height,
      hotspot.bounds,
    )
    if (!clippedPad) {
      throw new Error(`${hotspot.name} target pad is outside its viewport`)
    }

    const routeGraphics = convertSrjToGraphicsObject(
      { ...outputSrj, connections: [], obstacles: [], traces },
      { traceColorMode: "layer" },
    )
    const hotspotViolations = violations.filter(
      (violation) => violation.padId === hotspot.padId,
    )
    const hotspotMarkers = markers.filter(
      (marker) => marker.padId === hotspot.padId,
    )
    const violationLabel =
      hotspotViolations.length === 0
        ? "CLEAR"
        : `${hotspotViolations.length} LOGICAL / ${hotspotMarkers.length} PHYSICAL`
    const viaCenterClearance =
      (outputSrj.minViaDiameter ?? 0.3) / 2 + requiredViaPadClearance
    const outOfBoundsMarkers = hotspotMarkers.filter(
      (marker) =>
        marker.center.x - viaCenterClearance < hotspot.bounds.minX ||
        marker.center.x + viaCenterClearance > hotspot.bounds.maxX ||
        marker.center.y - viaCenterClearance < hotspot.bounds.minY ||
        marker.center.y + viaCenterClearance > hotspot.bounds.maxY,
    )
    if (outOfBoundsMarkers.length > 0) {
      throw new Error(`${hotspot.name} has a marker outside its fixed viewport`)
    }

    return {
      name: `${hotspot.name} · ${violationLabel}`,
      graphics: {
        lines: [
          ...clipGraphicsLines(routeGraphics.lines ?? [], hotspot.bounds),
          ...getClippedRectOutline({
            center: obstacle.center,
            width: obstacle.width,
            height: obstacle.height,
            bounds: hotspot.bounds,
            strokeColor: "#b45309",
          }),
          ...getClippedRectOutline({
            center: obstacle.center,
            width: obstacle.width + viaCenterClearance * 2,
            height: obstacle.height + viaCenterClearance * 2,
            bounds: hotspot.bounds,
            strokeColor: "#f59e0b",
          }),
        ],
        circles: [
          ...(routeGraphics.circles ?? []).filter((circle) =>
            pointIsInBounds(circle.center, hotspot.bounds),
          ),
          ...hotspotMarkers.map((marker) => ({
            center: marker.center,
            radius: viaCenterClearance,
            fill: "rgba(220, 38, 38, 0.08)",
            stroke: "#dc2626",
            label: `${hotspot.name} via-pad violation`,
          })),
        ],
        rects: [
          {
            ...clippedPad,
            fill: "rgba(245, 158, 11, 0.2)",
            label: `${hotspot.name} ${hotspot.padId}`,
          },
          {
            center: {
              x: (hotspot.bounds.minX + hotspot.bounds.maxX) / 2,
              y: (hotspot.bounds.minY + hotspot.bounds.maxY) / 2,
            },
            width: hotspot.bounds.maxX - hotspot.bounds.minX,
            height: hotspot.bounds.maxY - hotspot.bounds.minY,
            fill: "rgba(255, 255, 255, 0)",
            stroke: "#0f172a",
            label: `${hotspot.name} fixed viewport`,
          },
        ],
      },
    }
  })

const getOutputConnectivity = (
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  outputTraces: SimplifiedPcbTrace[],
  circuitJson: AnyCircuitElement[],
): ConnectivityMap => {
  const connMap = getConnectivityMapFromSimpleRouteJson(
    solver.srjWithPointPairs!,
  )
  connMap.addConnections(
    outputTraces.flatMap((trace) =>
      trace.connection_name
        ? [[trace.pcb_trace_id, trace.connection_name]]
        : [],
    ),
  )
  connMap.addConnections(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof (element as CircuitVia).pcb_trace_id === "string"
        ? [[element.pcb_via_id, (element as CircuitVia).pcb_trace_id!]]
        : [],
    ),
  )
  return connMap
}

test("bugreport99 records Pipeline9 nRF52810 via-to-pad clearance violations", async () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const outputTraces = solver.getOutputSimplifiedPcbTraces()
  const evaluatedDrc = evaluateRelaxedDrc({
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: outputTraces,
  })
  const connMap = getOutputConnectivity(
    solver,
    outputTraces,
    evaluatedDrc.circuitJson,
  )
  const viaById = new Map(
    evaluatedDrc.circuitJson.flatMap((element) =>
      element.type === "pcb_via"
        ? [[element.pcb_via_id, element as CircuitVia] as const]
        : [],
    ),
  )
  const obstacleByPadId = new Map(
    srj.obstacles.flatMap((obstacle) => {
      const padId = obstacle.circuitJsonMetadata?.pcb_smtpad_id
      return typeof padId === "string" ? [[padId, obstacle] as const] : []
    }),
  )
  const viaPadErrors = checkViaPadClearance(evaluatedDrc.circuitJson, {
    connMap,
    minClearance: requiredViaPadClearance,
  })
  const violations: ViaPadViolation[] = viaPadErrors.map((error) => {
    const [viaId, padId] = error.pcb_pad_ids
    const via = viaById.get(viaId)!
    const obstacle = obstacleByPadId.get(padId)!
    return {
      actualClearance: roundMetric(Number(error.actual_clearance)),
      center: {
        x: roundMetric(Number(error.center!.x)),
        y: roundMetric(Number(error.center!.y)),
      },
      componentId: obstacle.componentId!,
      ownerTraceId: via.pcb_trace_id!,
      padId,
      portName: obstacle.circuitJsonMetadata!.source_port_name!,
    }
  })

  expect(violations).toEqual([
    {
      actualClearance: 0,
      center: { x: 4.877247105, y: 0.109485708 },
      componentId: "pcb_component_2",
      ownerTraceId: "source_net_3_mst1_0",
      padId: "pcb_smtpad_58",
      portName: "VBAT_N",
    },
    {
      actualClearance: 0.085,
      center: { x: 9.433505208, y: 3.5775 },
      componentId: "pcb_component_29",
      ownerTraceId: "source_net_1_mst14_0",
      padId: "pcb_smtpad_105",
      portName: "pin2",
    },
    {
      actualClearance: 0.083452537,
      center: { x: 1.238273731, y: 11.124491625 },
      componentId: "pcb_component_22",
      ownerTraceId: "source_net_0_mst7_0",
      padId: "pcb_smtpad_90",
      portName: "pin1",
    },
    {
      actualClearance: 0.083452537,
      center: { x: 1.238273731, y: 11.124491625 },
      componentId: "pcb_component_22",
      ownerTraceId: "source_net_0_mst8_0",
      padId: "pcb_smtpad_90",
      portName: "pin1",
    },
  ])
  expect(
    new Set(
      checkViaPadClearance(evaluatedDrc.circuitJson, {
        connMap,
        minClearance: requiredViaPadClearance,
      }).map((error) => {
        const [viaId, padId] = error.pcb_pad_ids
        const via = viaById.get(viaId)!
        return `${padId}:${via.x},${via.y}`
      }),
    ).size,
  ).toBe(3)

  // Circuit JSON aliases suppress the two coincident C1 transitions, while
  // the SRJ logical ownership above preserves all four foreign-net owners.
  const circuitConnectivity = getFullConnectivityMapFromCircuitJson(
    evaluatedDrc.circuitJson,
  )
  circuitConnectivity.addConnections(
    evaluatedDrc.circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof (element as CircuitVia).pcb_trace_id === "string"
        ? [[element.pcb_via_id, (element as CircuitVia).pcb_trace_id!]]
        : [],
    ),
  )
  expect(
    checkViaPadClearance(evaluatedDrc.circuitJson, {
      connMap: circuitConnectivity,
      minClearance: requiredViaPadClearance,
    }).map((error) => ({
      actualClearance: roundMetric(Number(error.actual_clearance)),
      padId: error.pcb_pad_ids[1],
    })),
  ).toEqual([
    { actualClearance: 0, padId: "pcb_smtpad_58" },
    {
      actualClearance: 0.085,
      padId: "pcb_smtpad_105",
    },
  ])
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .drcBranchPortfolioViaInPadPhaseAttempted,
  ).toBe(true)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .globalDrcForceImproveViaInPadCandidateAttempts,
  ).toBe(0)

  const physicalMarkers = [
    ...new Map(
      viaPadErrors.map((error) => {
        const [viaId, padId] = error.pcb_pad_ids
        const via = viaById.get(viaId)!
        const marker: ViaPadMarker = {
          center: {
            x: roundMetric(via.x),
            y: roundMetric(via.y),
          },
          padId,
        }
        return [
          `${marker.padId}:${marker.center.x},${marker.center.y}`,
          marker,
        ] as const
      }),
    ).values(),
  ]
  await expect(
    getGraphicsSvgFrames({
      frames: getHotspotFrames({
        outputSrj: solver.getOutputSimpleRouteJson(),
        violations,
        markers: physicalMarkers,
      }),
      columns: 3,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "via-pad-hotspots",
    tolerance: 0,
  })
})

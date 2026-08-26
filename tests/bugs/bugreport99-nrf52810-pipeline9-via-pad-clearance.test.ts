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

const ANNOTATION_PANEL_WIDTH = Math.max(
  ...HOTSPOTS.map((hotspot) => hotspot.bounds.maxX - hotspot.bounds.minX),
)
const ANNOTATION_PANEL_HEIGHT = 1.42
const ANNOTATION_PANEL_GAP = 0.14
const ANNOTATION_FONT_SIZE = 0.115
const STATUS_FONT_SIZE = 0.092
const STATUS_DETAIL_FONT_SIZE = 0.08
const PAD_FILL = "rgba(245, 158, 11, 0.2)"
const PAD_EDGE_COLOR = "#b45309"
const VIA_CENTER_KEEPOUT_COLOR = "#f59e0b"
const VIOLATION_COLOR = "#dc2626"
const CLEAR_COLOR = "#16a34a"
const TOP_COPPER_COLOR = "#0284c7"
const BOTTOM_COPPER_COLOR = "#7c3aed"
const VIA_COLOR = "#1e3a8a"

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
  strokeDash,
  strokeWidth = 0.025,
}: {
  center: { x: number; y: number }
  width: number
  height: number
  bounds: FocusBounds
  strokeColor: string
  strokeDash?: string | number[]
  strokeWidth?: number
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
    return points ? [{ points, strokeColor, strokeWidth, strokeDash }] : []
  })
}

const getAnnotationPanelGraphics = ({
  bounds,
  logicalViolationCount,
  physicalViolationCount,
}: {
  bounds: FocusBounds
  logicalViolationCount: number
  physicalViolationCount: number
}): GraphicsObject => {
  const centerX = (bounds.minX + bounds.maxX) / 2
  const panelTop = bounds.minY - ANNOTATION_PANEL_GAP
  const panelBottom = panelTop - ANNOTATION_PANEL_HEIGHT
  const panelLeft = centerX - ANNOTATION_PANEL_WIDTH / 2
  const row1Y = panelTop - 0.23
  const row2Y = panelTop - 0.57
  const row3Y = panelTop - 0.91
  const row4Y = panelTop - 1.18
  const hasViolations = physicalViolationCount > 0
  const ownershipText =
    logicalViolationCount > physicalViolationCount
      ? `${logicalViolationCount} traces coincide at this via location`
      : `${logicalViolationCount} trace at this via location`
  const statusText = hasViolations
    ? `FAIL: ${ownershipText}`
    : "CLEAR: repaired route keeps all vias outside keep-out"

  return {
    rects: [
      {
        center: {
          x: centerX,
          y: (panelTop + panelBottom) / 2,
        },
        width: ANNOTATION_PANEL_WIDTH,
        height: ANNOTATION_PANEL_HEIGHT,
        fill: "rgba(248, 250, 252, 0.98)",
        stroke: "#cbd5e1",
        label: "visual key",
      },
      {
        center: { x: panelLeft + 0.18, y: row1Y },
        width: 0.2,
        height: 0.16,
        fill: PAD_FILL,
        stroke: PAD_EDGE_COLOR,
      },
      {
        center: { x: panelLeft + 0.245, y: row2Y },
        width: 0.31,
        height: 0.07,
        fill: TOP_COPPER_COLOR,
        stroke: "none",
      },
      ...[1.55, 1.68, 1.81].map((xOffset) => ({
        center: { x: panelLeft + xOffset, y: row1Y },
        width: 0.08,
        height: 0.045,
        fill: VIA_CENTER_KEEPOUT_COLOR,
        stroke: "none",
      })),
      ...[1.43, 1.535, 1.64].map((xOffset) => ({
        center: { x: panelLeft + xOffset, y: row2Y },
        width: 0.07,
        height: 0.07,
        fill: BOTTOM_COPPER_COLOR,
        stroke: "none",
      })),
    ],
    lines: [],
    circles: [
      {
        center: { x: panelLeft + 3.17, y: row2Y },
        radius: 0.08,
        fill: VIA_COLOR,
        stroke: "none",
      },
      {
        center: { x: panelLeft + 0.18, y: row3Y },
        radius: 0.11,
        fill: hasViolations
          ? "rgba(220, 38, 38, 0.08)"
          : "rgba(22, 163, 74, 0.08)",
        stroke: hasViolations ? VIOLATION_COLOR : CLEAR_COLOR,
      },
      {
        center: { x: panelLeft + 0.18, y: row3Y },
        radius: 0.045,
        fill: hasViolations ? VIA_COLOR : CLEAR_COLOR,
        stroke: "none",
      },
    ],
    texts: [
      {
        x: panelLeft + 0.34,
        y: row1Y,
        text: "foreign pad",
        anchorSide: "center_left",
        fontSize: ANNOTATION_FONT_SIZE,
        color: "#7c2d12",
      },
      {
        x: panelLeft + 1.96,
        y: row1Y,
        text: "via-center keep-out",
        anchorSide: "center_left",
        fontSize: ANNOTATION_FONT_SIZE,
        color: "#92400e",
      },
      {
        x: panelLeft + 0.49,
        y: row2Y,
        text: "top copper",
        anchorSide: "center_left",
        fontSize: ANNOTATION_FONT_SIZE,
        color: TOP_COPPER_COLOR,
      },
      {
        x: panelLeft + 1.78,
        y: row2Y,
        text: "bottom copper",
        anchorSide: "center_left",
        fontSize: ANNOTATION_FONT_SIZE,
        color: BOTTOM_COPPER_COLOR,
      },
      {
        x: panelLeft + 3.32,
        y: row2Y,
        text: "via",
        anchorSide: "center_left",
        fontSize: ANNOTATION_FONT_SIZE,
        color: VIA_COLOR,
      },
      {
        x: panelLeft + 0.38,
        y: row3Y,
        text: statusText,
        anchorSide: "center_left",
        fontSize: STATUS_FONT_SIZE,
        color: hasViolations ? "#991b1b" : "#166534",
      },
      ...(hasViolations
        ? [
            {
              x: panelLeft + 0.38,
              y: row4Y,
              text: `red halo = via body + ${requiredViaPadClearance.toFixed(3)} mm clearance; halo overlaps pad`,
              anchorSide: "center_left" as const,
              fontSize: STATUS_DETAIL_FONT_SIZE,
              color: "#991b1b",
            },
          ]
        : []),
    ],
  }
}

const getCalloutGraphics = ({
  bounds,
  callouts,
}: {
  bounds: FocusBounds
  callouts: Array<{
    color: string
    label: string
    side: "left" | "right"
    target: { x: number; y: number }
  }>
}): GraphicsObject => {
  const viewportWidth = bounds.maxX - bounds.minX
  const viewportHeight = bounds.maxY - bounds.minY
  const fontSize = 0.12
  const labelHeight = 0.24
  const labelY = bounds.maxY - Math.min(viewportHeight * 0.09, 0.24)
  const labelCenters = {
    left: bounds.minX + Math.min(viewportWidth * 0.24, 0.72),
    right: bounds.maxX - Math.min(viewportWidth * 0.24, 0.72),
  }
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const circles: NonNullable<GraphicsObject["circles"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  for (const callout of callouts) {
    const labelWidth = callout.label.length * fontSize * 0.62 + 0.18
    const labelCenter = { x: labelCenters[callout.side], y: labelY }
    rects.push({
      center: labelCenter,
      width: labelWidth,
      height: labelHeight,
      fill: "rgba(255, 255, 255, 0.94)",
      stroke: callout.color,
      label: callout.label,
    })
    lines.push({
      points: [
        { x: labelCenter.x, y: labelCenter.y - labelHeight / 2 },
        callout.target,
      ],
      strokeColor: callout.color,
      strokeWidth: 0.025,
    })
    circles.push({
      center: callout.target,
      radius: 0.055,
      fill: "rgba(255, 255, 255, 0.7)",
      stroke: callout.color,
      label: callout.label,
    })
    texts.push({
      x: labelCenter.x,
      y: labelCenter.y,
      text: callout.label,
      anchorSide: "center",
      fontSize,
      color: callout.color,
    })
  }

  return { rects, lines, circles, texts }
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
    const clippedRouteLines = clipGraphicsLines(
      routeGraphics.lines ?? [],
      hotspot.bounds,
    ).map((line) => ({
      ...line,
      strokeColor: line.strokeDash ? BOTTOM_COPPER_COLOR : TOP_COPPER_COLOR,
    }))
    const visibleRouteVias = (routeGraphics.circles ?? [])
      .filter((circle) => pointIsInBounds(circle.center, hotspot.bounds))
      .map((circle) => ({ ...circle, fill: VIA_COLOR }))
    const closestVisibleRouteVia = visibleRouteVias.toSorted(
      (left, right) =>
        Math.hypot(
          left.center.x - obstacle.center.x,
          left.center.y - obstacle.center.y,
        ) -
        Math.hypot(
          right.center.x - obstacle.center.x,
          right.center.y - obstacle.center.y,
        ),
    )[0]
    const closestRouteMidpoint = clippedRouteLines
      .flatMap((line) =>
        line.points.slice(0, -1).map((point, pointIndex) => ({
          x: (point.x + line.points[pointIndex + 1]!.x) / 2,
          y: (point.y + line.points[pointIndex + 1]!.y) / 2,
        })),
      )
      .sort(
        (left, right) =>
          Math.hypot(left.x - obstacle.center.x, left.y - obstacle.center.y) -
          Math.hypot(right.x - obstacle.center.x, right.y - obstacle.center.y),
      )[0]
    if (!closestRouteMidpoint) {
      throw new Error(`${hotspot.name} has no routed trace in its viewport`)
    }
    const clearanceReferencePoint =
      hotspotMarkers[0]?.center ?? closestRouteMidpoint
    const padCalloutTarget = [
      { x: -0.25, y: -0.25 },
      { x: -0.25, y: 0.25 },
      { x: 0.25, y: -0.25 },
      { x: 0.25, y: 0.25 },
    ]
      .map((offset) => ({
        x: clippedPad.center.x + clippedPad.width * offset.x,
        y: clippedPad.center.y + clippedPad.height * offset.y,
      }))
      .sort(
        (left, right) =>
          Math.hypot(
            right.x - clearanceReferencePoint.x,
            right.y - clearanceReferencePoint.y,
          ) -
          Math.hypot(
            left.x - clearanceReferencePoint.x,
            left.y - clearanceReferencePoint.y,
          ),
      )[0]!
    const annotationPanel = getAnnotationPanelGraphics({
      bounds: hotspot.bounds,
      logicalViolationCount: hotspotViolations.length,
      physicalViolationCount: hotspotMarkers.length,
    })
    const callouts = getCalloutGraphics({
      bounds: hotspot.bounds,
      callouts: [
        {
          color: hotspotMarkers.length > 0 ? VIOLATION_COLOR : CLEAR_COLOR,
          label:
            hotspotMarkers.length > 0
              ? "OFFENDING VIA"
              : closestVisibleRouteVia
                ? "REPAIRED VIA"
                : "REROUTED COPPER",
          side: "left",
          target:
            hotspotMarkers[0]?.center ??
            closestVisibleRouteVia?.center ??
            closestRouteMidpoint,
        },
        {
          color: PAD_EDGE_COLOR,
          label: "FOREIGN PAD",
          side: "right",
          target: padCalloutTarget,
        },
      ],
    })
    const clearanceStatus =
      hotspotViolations.length === 0
        ? `CLEAR — via-pad clearance ≥ ${requiredViaPadClearance.toFixed(3)} mm`
        : `FAIL — ${Math.min(...hotspotViolations.map((violation) => violation.actualClearance)).toFixed(3)} mm < ${requiredViaPadClearance.toFixed(3)} mm`

    return {
      name: `${hotspot.name} · ${clearanceStatus}`,
      showMetadata: false,
      graphics: {
        lines: [
          ...clippedRouteLines,
          ...getClippedRectOutline({
            center: obstacle.center,
            width: obstacle.width,
            height: obstacle.height,
            bounds: hotspot.bounds,
            strokeColor: PAD_EDGE_COLOR,
          }),
          ...getClippedRectOutline({
            center: obstacle.center,
            width: obstacle.width + viaCenterClearance * 2,
            height: obstacle.height + viaCenterClearance * 2,
            bounds: hotspot.bounds,
            strokeColor: VIA_CENTER_KEEPOUT_COLOR,
            strokeDash: "4 3",
            strokeWidth: 0.04,
          }),
          ...(callouts.lines ?? []),
          ...(annotationPanel.lines ?? []),
        ],
        circles: [
          ...visibleRouteVias,
          ...hotspotMarkers.map((marker) => ({
            center: marker.center,
            radius: viaCenterClearance,
            fill: "rgba(220, 38, 38, 0.08)",
            stroke: VIOLATION_COLOR,
            label: `${hotspot.name} via-pad violation`,
          })),
          ...(callouts.circles ?? []),
          ...(annotationPanel.circles ?? []),
        ],
        rects: [
          {
            ...clippedPad,
            fill: PAD_FILL,
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
          ...(callouts.rects ?? []),
          ...(annotationPanel.rects ?? []),
        ],
        texts: [...(callouts.texts ?? []), ...(annotationPanel.texts ?? [])],
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
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "via-pad-hotspots",
    tolerance: 0,
  })
})

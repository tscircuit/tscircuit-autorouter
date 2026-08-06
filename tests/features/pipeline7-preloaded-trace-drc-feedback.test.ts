import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type { SimplifiedPcbTraces as RepairSimplifiedPcbTraces } from "high-density-repair03/lib"
import { stackSvgsHorizontally } from "stack-svgs"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const addPanelHeader = ({
  svg,
  title,
  titleColor,
  details,
}: {
  svg: string
  title: string
  titleColor: string
  details: [string, string]
}): string => {
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1])
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1])
  if (bodyStart === 0 || bodyEnd === -1 || !width || !height) {
    throw new Error("Expected complete SVG dimensions and markup")
  }

  const headerHeight = 76
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="23" font-family="monospace" font-size="15" font-weight="700" fill="${titleColor}">${title}</text><text x="12" y="43" font-family="monospace" font-size="12" fill="#444">${details[0]}</text><text x="12" y="61" font-family="monospace" font-size="12" fill="#444">${details[1]}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

const addCollisionMarker = (graphics: GraphicsObject): GraphicsObject => ({
  ...graphics,
  circles: [
    ...(graphics.circles ?? []),
    {
      center: { x: 0, y: 0 },
      radius: 0.35,
      fill: "rgba(220, 38, 38, 0.25)",
      stroke: "#b91c1c",
    },
  ],
  lines: [
    ...(graphics.lines ?? []),
    {
      points: [
        { x: -0.22, y: -0.22 },
        { x: 0.22, y: 0.22 },
      ],
      strokeColor: "#991b1b",
      strokeWidth: 0.05,
    },
    {
      points: [
        { x: -0.22, y: 0.22 },
        { x: 0.22, y: -0.22 },
      ],
      strokeColor: "#991b1b",
      strokeWidth: 0.05,
    },
  ],
})

const showOmittedPreloadedTrace = (
  graphics: GraphicsObject,
): GraphicsObject => ({
  ...graphics,
  rects: [
    ...(graphics.rects ?? []),
    {
      center: { x: 0, y: 0 },
      width: 0.7,
      height: 2,
      fill: "rgba(245, 158, 11, 0.18)",
      stroke: "#b45309",
    },
  ],
  lines: [
    ...(graphics.lines ?? []),
    {
      points: [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ],
      strokeColor: "#b45309",
      strokeWidth: 0.04,
      strokeDash: [0.12, 0.08],
    },
  ],
})

const getTraceCollisionCount = (errors: unknown[]): number =>
  errors.filter(
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "pcb_trace_error_id" in error &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  ).length

const renderPanel = (graphics: GraphicsObject): string =>
  getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    hideInlineLabels: true,
    svgWidth: 560,
    svgHeight: 360,
  })

test("Pipeline7 DRC feedback includes preloaded traces", () => {
  const fixedConnection: SimpleRouteConnection = {
    name: "fixed",
    pointsToConnect: [
      { x: 0, y: -1, layer: "top", pointId: "fixed-start" },
      { x: 0, y: 1, layer: "top", pointId: "fixed-end" },
    ],
  }
  const candidateConnection: SimpleRouteConnection = {
    name: "candidate",
    pointsToConnect: [
      { x: -1, y: 0, layer: "top", pointId: "candidate-start" },
      { x: 1, y: 0, layer: "top", pointId: "candidate-end" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -1.5, minY: -1.5, maxX: 1.5, maxY: 1.5 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    connections: [fixedConnection, candidateConnection],
    obstacles: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_0",
        connection_name: "fixed",
        connectsTo: ["fixed-start", "fixed-end"],
        route: [
          {
            route_type: "wire",
            x: 0,
            y: -1,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 0,
            y: 1,
            width: 0.15,
            layer: "top",
          },
        ],
      },
    ],
  }
  const candidateRoutes: HighDensityRoute[] = [
    {
      connectionName: "candidate",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  const conversionOptions = {
    connections: [candidateConnection],
    originalConnections: inputSrj.connections,
    layerCount: inputSrj.layerCount,
    obstacles: inputSrj.obstacles,
    defaultViaHoleDiameter: 0.2,
    connMap,
    srjWithPointPairs: inputSrj,
    originalSrj: inputSrj,
  }
  const candidateTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    ...conversionOptions,
    hdRoutes: candidateRoutes,
  })
  const referenceDrc = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: candidateTraces,
  })
  const optimizedDrcResult = createPipeline7AutoroutingDrcEvaluator(
    conversionOptions,
  )({
    routes: candidateRoutes,
    traces: candidateTraces as unknown as RepairSimplifiedPcbTraces,
  })
  const optimizedDrcErrors = Array.isArray(optimizedDrcResult)
    ? optimizedDrcResult
    : optimizedDrcResult.errors
  const referenceCollisionCount = getTraceCollisionCount(referenceDrc.errors)
  const optimizedCollisionCount = getTraceCollisionCount(optimizedDrcErrors)

  expect(referenceCollisionCount).toBe(1)
  expect(optimizedCollisionCount).toBe(0)

  const completeBoardGraphics = convertSrjToGraphicsObject(
    { ...inputSrj, traces: [...inputSrj.traces!, ...candidateTraces] },
    { traceColorMode: "net" },
  )
  const candidateOnlyGraphics = convertSrjToGraphicsObject(
    { ...inputSrj, traces: candidateTraces },
    { traceColorMode: "net" },
  )
  const optimizedFeedbackGraphics =
    optimizedCollisionCount === referenceCollisionCount
      ? addCollisionMarker(completeBoardGraphics)
      : showOmittedPreloadedTrace(candidateOnlyGraphics)

  expect(
    stackSvgsHorizontally(
      [
        addPanelHeader({
          svg: renderPanel(addCollisionMarker(completeBoardGraphics)),
          title: `PHYSICAL BOARD · ${referenceCollisionCount} COLLISION`,
          titleColor: "#b91c1c",
          details: [
            "The fixed vertical trace crosses the candidate trace.",
            "Reference DRC correctly marks the collision in red.",
          ],
        }),
        addPanelHeader({
          svg: renderPanel(optimizedFeedbackGraphics),
          title:
            optimizedCollisionCount === referenceCollisionCount
              ? "PIPELINE7 FEEDBACK · COLLISION DETECTED"
              : "PIPELINE7 FEEDBACK · COLLISION MISSED",
          titleColor:
            optimizedCollisionCount === referenceCollisionCount
              ? "#b91c1c"
              : "#b45309",
          details:
            optimizedCollisionCount === referenceCollisionCount
              ? [
                  "Fixed copper is included in candidate evaluation.",
                  "The crossing is rejected before accepting the repair.",
                ]
              : [
                  "Amber marks the fixed copper omitted from evaluation.",
                  "The crossing candidate is incorrectly accepted as clean.",
                ],
        }),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

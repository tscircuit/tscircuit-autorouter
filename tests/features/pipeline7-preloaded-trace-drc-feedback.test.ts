import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SimplifiedPcbTraces as RepairSimplifiedPcbTraces } from "high-density-repair03/lib"
import { stackSvgsHorizontally } from "stack-svgs"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const addPanelTitle = (svg: string, title: string, detail: string): string => {
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1])
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1])
  if (bodyStart === 0 || bodyEnd === -1 || !width || !height) {
    throw new Error("Expected complete SVG dimensions and markup")
  }

  const headerHeight = 56
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="23" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="12" y="43" font-family="monospace" font-size="12" fill="#444">${detail}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

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
  const getTraceCollisionCount = (errors: unknown[]) =>
    errors.filter(
      (error) =>
        typeof error === "object" &&
        error !== null &&
        "pcb_trace_error_id" in error &&
        typeof error.pcb_trace_error_id === "string" &&
        error.pcb_trace_error_id.startsWith("overlap_"),
    ).length
  const referenceCollisionCount = getTraceCollisionCount(referenceDrc.errors)
  const optimizedCollisionCount = getTraceCollisionCount(optimizedDrcErrors)

  expect(referenceCollisionCount).toBe(1)
  expect(optimizedCollisionCount).toBe(0)

  const boardSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(
      { ...inputSrj, traces: [...inputSrj.traces!, ...candidateTraces] },
      { traceColorMode: "net" },
    ),
    {
      backgroundColor: "white",
      hideInlineLabels: true,
      svgWidth: 560,
      svgHeight: 360,
    },
  )
  expect(
    stackSvgsHorizontally(
      [
        addPanelTitle(
          boardSvg,
          `REFERENCE DRC · ${referenceCollisionCount} COLLISION`,
          "Fixed and candidate traces cross on the top layer.",
        ),
        addPanelTitle(
          boardSvg,
          `OPTIMIZED FEEDBACK · ${optimizedCollisionCount} COLLISIONS`,
          "The candidate-only check omits the fixed trace.",
        ),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

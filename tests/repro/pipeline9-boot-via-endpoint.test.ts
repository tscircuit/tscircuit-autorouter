import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { CircuitJson } from "circuit-json"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimplifiedPcbTrace,
} from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getBootViaCandidateGraphics } from "../fixtures/getBootViaCandidateGraphics"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedBootVia from "./assets/pipeline9-boot-via-candidate.json" with {
  type: "json",
}

type BootViaCapture = {
  circuitJson: CircuitJson
  candidateRoute: HighDensityRoute
  preloadedTraces: SimplifiedPcbTrace[]
  obstacles: Obstacle[]
  connections: SimpleRouteConnection[]
  nodeWithPortPoints: NodeWithPortPoints
  provenance: {
    layerCount: number
    viaToPadClearance: number
  }
}

test("Pipeline9 validates the captured T113-S3 boot resistor via endpoint", () => {
  const captured: BootViaCapture = structuredClone(capturedBootVia)
  const originalCapture = structuredClone(captured)
  const { circuitJson, candidateRoute, obstacles, provenance } = captured
  const resistor = circuitJson.find(
    (element) =>
      element.type === "source_component" && element.name === "R_BOOT_SEL1",
  )!
  expect(resistor).toMatchObject({
    ftype: "simple_resistor",
    resistance: 3300,
    manufacturer_part_number: "0402WGF3301TCE",
  })
  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "source_trace",
      name: "BOOT_SEL1_TO_SOC",
      connected_source_port_ids: ["source_port_261", "source_port_15"],
    }),
  )
  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "source_port",
      source_port_id: "source_port_15",
      name: "PC5",
      pin_number: 16,
    }),
  )
  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "source_trace",
      source_trace_id: "source_trace_122",
      connected_source_port_ids: ["source_port_262"],
      connected_source_net_ids: ["source_net_14"],
    }),
  )
  for (const obstacle of obstacles) {
    expect(circuitJson).toContainEqual(
      expect.objectContaining({
        type: "pcb_smtpad",
        pcb_smtpad_id: obstacle.circuitJsonMetadata!.pcb_smtpad_id,
        x: obstacle.center.x,
        y: obstacle.center.y,
        width: obstacle.width,
        height: obstacle.height,
      }),
    )
  }

  const connMap = getConnectivityMapFromSimpleRouteJson({
    layerCount: provenance.layerCount,
    minTraceWidth: candidateRoute.traceThickness,
    bounds: { minX: -3, maxX: -1, minY: 40, maxY: 42 },
    connections: captured.connections,
    obstacles,
    traces: captured.preloadedTraces,
  })
  // This is the captured replacement of source_trace_122, not a new net.
  connMap.addConnections([
    [
      candidateRoute.connectionName,
      candidateRoute.rootConnectionName!,
      "source_trace_122",
    ],
  ])
  const signalPad = obstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.source_port_name === "pin1",
  )!
  const groundPad = obstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.source_port_name === "pin2",
  )!
  expect(
    isObstacleConnectedToRoute(signalPad, candidateRoute, connMap),
  ).toBeFalse()
  expect(
    isObstacleConnectedToRoute(groundPad, candidateRoute, connMap),
  ).toBeTrue()
  const fallback = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: captured.nodeWithPortPoints,
    colorMap: { [candidateRoute.connectionName]: "blue" },
    connMap,
    viaDiameter: candidateRoute.viaDiameter,
    traceWidth: candidateRoute.traceThickness,
    obstacleMargin: provenance.viaToPadClearance,
    effort: 1,
    obstacles,
    boardObstacles: obstacles,
    movablePreloadedConnectionNames: new Set([candidateRoute.connectionName]),
    viaToPadClearance: provenance.viaToPadClearance,
    layerCount: provenance.layerCount,
  })
  const validate = fallback.highDensitySolver.growShrinkSolutionValidator!
  const [materializedRoute] = materializePipeline9HdRouteVias([candidateRoute])
  const rawGeometry = getPipeline9RouteCopperGeometry(candidateRoute)
  const materializedGeometry = getPipeline9RouteCopperGeometry(
    materializedRoute!,
  )
  const rawAccepted = validate([candidateRoute])
  const materializedAccepted = validate([materializedRoute!])
  const actualVia = materializedGeometry.viaSpans[0]!
  expect(actualVia.center).toEqual(candidateRoute.vias[0])
  expect(
    pointToBoxDistance(actualVia.center, signalPad) - actualVia.diameter / 2,
  ).toBeCloseTo(0.051188823, 8)
  expect(materializedAccepted).toBeFalse()
  expect(rawAccepted).toBeFalse()
  expect(rawGeometry).toEqual(materializedGeometry)
  expect(captured).toEqual(originalCapture)

  const snapshot = getGraphicsSvgFrames({
    columns: 2,
    cellHeight: 2.7,
    cellWidth: 3.3,
    backgroundColor: "white",
    frames: [
      {
        name: "Raw candidate interpretation",
        graphics: getBootViaCandidateGraphics({
          geometry: rawGeometry,
          pads: obstacles,
          accepted: rawAccepted,
          clearance: provenance.viaToPadClearance,
        }),
      },
      {
        name: "Materialized explicit-via copper",
        graphics: getBootViaCandidateGraphics({
          geometry: materializedGeometry,
          pads: obstacles,
          accepted: materializedAccepted,
          clearance: provenance.viaToPadClearance,
        }),
      },
    ],
  })
  expect(snapshot).toMatchSvgSnapshot(import.meta.path)
})

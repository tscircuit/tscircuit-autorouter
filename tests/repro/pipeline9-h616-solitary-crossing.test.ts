import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getH616TerminalStitchCircuit } from "tests/fixtures/getH616TerminalStitchCircuit"

type H616SolitaryCrossingFixture = {
  board: { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  uniformInput: Omit<UniformPortDistributionSolverInput, "obstacles">
  highDensityInput: Omit<
    Pipeline9HighDensitySolverParams,
    "connMap" | "obstacles" | "colorMap"
  >
  obstacles: Obstacle[]
  connections: SimpleRouteJson["connections"]
  netMap: ConstructorParameters<typeof ConnectivityMap>[0]
}

test("routes the H616 ZQ1 crossing beside existing DDR copper", async (): Promise<void> => {
  // Native 125-component H616 board, captured from the remaining-signal
  // phase in tscircuit 0.0.3169 before routing this shared-edge region.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-solitary-crossing.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616SolitaryCrossingFixture
  const plannedNode = fixture.highDensityInput.nodePortPoints[0]!
  const connMap = new ConnectivityMap(fixture.netMap)
  const uniform = new UniformPortDistributionSolver({
    ...fixture.uniformInput,
    obstacles: fixture.obstacles,
  })
  uniform.solve()
  const node = uniform
    .getOutput()
    .find(
      (candidate) =>
        candidate.capacityMeshNodeId === plannedNode.capacityMeshNodeId,
    )
  if (!node) throw new Error("Missing native ZQ1 routing region")
  const crossing = node.portPoints.find((point) => point.z > 0)
  if (!crossing) throw new Error("Missing native ZQ1 inner-layer crossing")
  const sdqm1 = fixture.board.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SDQM1",
  )
  if (sdqm1?.type !== "source_trace") throw new Error("Missing native SDQM1")
  let minimumCopperGap = Infinity
  const crossingRadius = fixture.highDensityInput.traceWidth / 2
  for (const route of fixture.highDensityInput.fixedHdRoutes) {
    if (
      !sdqm1.connected_source_net_ids?.includes(
        fixture.board.srj.traces![route.preloadedTraceIndex]!.connection_name,
      )
    ) {
      continue
    }
    const geometry = getPipeline9RouteCopperGeometry(route, fixture.board.srj)
    for (const segment of geometry.wireSegments) {
      if (segment.z !== crossing.z) continue
      minimumCopperGap = Math.min(
        minimumCopperGap,
        pointToSegmentDistance(crossing, segment.start, segment.end) -
          segment.width / 2 -
          crossingRadius,
      )
    }
    for (const via of geometry.viaSpans) {
      if (crossing.z < via.minZ || crossing.z > via.maxZ) continue
      minimumCopperGap = Math.min(
        minimumCopperGap,
        Math.hypot(crossing.x - via.center.x, crossing.y - via.center.y) -
          via.diameter / 2 -
          crossingRadius,
      )
    }
  }
  expect(minimumCopperGap).toBeLessThan(0)
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.highDensityInput,
    nodePortPoints: [node],
    obstacles: fixture.obstacles,
    connMap,
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.routes).toHaveLength(0)
  for (const route of solver.routes) {
    for (const fixed of solver.getUpdatedFixedHdRoutes()) {
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: fixed,
          clearance: fixture.board.srj.minTraceToPadEdgeClearance!,
          layerCount: fixture.board.srj.layerCount,
          allowBlindAndBuriedVias: fixture.board.srj.allowBlindAndBuriedVias,
        }),
      ).toBeFalse()
    }
  }
  // Include accepted neighboring routes from the native routing phase. The
  // isolated region alone ends at shared-edge ports instead of component pads.
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(fixture.board.srj),
    { cacheProvider: null },
  )
  pipeline.solve()
  const contextSolver = pipeline.highDensityRouteSolver
  const contextSrj = pipeline.srjWithPointPairs
  if (!contextSolver || !contextSrj) {
    throw new Error("Missing native routing context for ZQ1")
  }
  expect(
    contextSolver.routes.filter(
      (route) => route.regionId === plannedNode.capacityMeshNodeId,
    ),
  ).toEqual(solver.routes)
  for (const route of solver.routes) {
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      expect(
        contextSolver.routes.some(
          (neighbor) =>
            neighbor.regionId !== route.regionId &&
            neighbor.connectionName === route.connectionName &&
            getPipeline9RouteCopperGeometry(
              neighbor,
              fixture.board.srj,
            ).wireSegments.some(
              (segment) =>
                segment.z === endpoint.z &&
                pointToSegmentDistance(endpoint, segment.start, segment.end) <=
                  (segment.width + route.traceThickness) / 2,
            ),
        ),
      ).toBeTrue()
    }
  }
  const circuit = getH616TerminalStitchCircuit({
    board: fixture.board,
    fixture: {
      input: {
        connections: contextSrj.connections,
        hdRoutes: [],
        layerCount: fixture.board.srj.layerCount,
      },
      preloadedRoutes: contextSolver.getUpdatedFixedHdRoutes(),
      netMap: pipeline.connMap.netMap,
    },
    hdRoutes: contextSolver.routes,
  })
  expect(
    circuit.filter((element) => element.type === "source_component"),
  ).toHaveLength(
    fixture.board.circuitJson.filter(
      (element) => element.type === "source_component",
    ).length,
  )
  const renderOptions = {
    backgroundColor: "white",
    colorOverrides: {
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
      },
      boardOutline: "#475569",
      silkscreen: { top: "#334155", bottom: "#334155" },
    },
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  }
  await expect(
    convertCircuitJsonToPcbSvg(circuit, {
      ...renderOptions,
      width: 1000,
      height: 2200,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  const focusedSourceTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "source_trace" &&
      (element.display_name?.includes("ZQ1") ||
        element.display_name === "/DRAM/SDQM1")
        ? [element.source_trace_id]
        : [],
    ),
  )
  expect(focusedSourceTraceIds.size).toBe(2)
  const focusedTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      focusedSourceTraceIds.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const focusedBoardWidth =
    plannedNode.width + fixture.highDensityInput.viaDiameter
  const focusedBoardHeight =
    plannedNode.height + fixture.highDensityInput.viaDiameter
  const focusedSvgHeight = Math.round(
    (900 * focusedBoardHeight) / focusedBoardWidth,
  )
  const focusedCircuit = circuit
    .filter((element) => {
      if (element.type === "pcb_trace") {
        return focusedTraceIds.has(element.pcb_trace_id)
      }
      if (element.type === "pcb_via") {
        return focusedTraceIds.has(element.pcb_trace_id!)
      }
      return true
    })
    .map((element): AnyCircuitElement => {
      if (element.type !== "pcb_board") return element
      return {
        ...element,
        center: plannedNode.center,
        width: focusedBoardWidth,
        height: focusedBoardHeight,
        outline: undefined,
      }
    })
  const focusedSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    ...renderOptions,
    width: 900,
    height: focusedSvgHeight,
    drawPaddingOutsideBoard: false,
  }).replace(
    "</svg>",
    '<rect x="0" y="0" width="900" height="45" fill="white"/><text x="450" y="30" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#334155">ZQ1 crossing / existing SDQM1 copper</text></svg>',
  )
  await expect(focusedSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "zq1",
    scale: 1,
  })
})

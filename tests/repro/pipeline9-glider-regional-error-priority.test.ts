import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type DrcError = Record<string, unknown>
type Point = { x: number; y: number }
type ProposalState = {
  phase: string
  context: {
    currentRoutes: HighDensityRoute[]
    currentErrors: DrcError[]
  }
  candidateRoutes: HighDensityRoute[]
  candidateReference: DrcError[] | { errors: DrcError[] }
}
type RegionalRepairControl = {
  state: {
    phase: string
    context: ProposalState["context"]
    solver?: Pipeline9ClearanceProjectionSolver
    candidateRoutes?: HighDensityRoute[]
  }
  prepareRegions(context: ProposalState["context"]): void
}

test("Glider circuit repair priorities", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/glider-regional-error-priority.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    srj: SimpleRouteJson
    connections: SimpleRouteConnection[]
    routes: HighDensityRoute[]
    netMap: ConstructorParameters<typeof ConnectivityMap>[0]
  }
  const original = structuredClone(fixture)
  const { srj, connections, routes } = fixture
  const connMap = new ConnectivityMap(fixture.netMap)
  const srjWithPointPairs = { ...srj, connections }
  const joint = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs,
    originalSrj: srj,
    newConnections: connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set<string>(),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: srj.minViaDiameter!,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    effort: 1,
    colorMap: {},
    connMap,
  })
  while (
    !joint.initialBoundedRegionalRepairSolver &&
    !joint.solved &&
    !joint.failed
  ) {
    joint.step()
  }
  const solver = joint.initialBoundedRegionalRepairSolver!
  const control = solver as unknown as RegionalRepairControl
  while (
    control.state.phase !== "initial-projection" &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }
  // Initial projection now bypasses regional acceptance; replay its real proposal
  // through production physical, reference and acceptance stages to cover that policy.
  const originalContext = { ...control.state.context }
  const projection = control.state.solver!
  projection.solve()
  const projectedRoutes = projection.getOutput()
  solver.step()
  control.prepareRegions(originalContext)
  control.state = {
    phase: "candidate-physical",
    context: control.state.context,
    candidateRoutes: projectedRoutes,
  }
  let decision: ProposalState | undefined
  while (!solver.solved && !solver.failed) {
    const state = control.state as ProposalState
    if (state.phase === "accept-candidate") {
      const errors = Array.isArray(state.candidateReference)
        ? state.candidateReference
        : state.candidateReference.errors
      if (
        state.context.currentErrors.some(
          (error): boolean => error.drc_source !== "fixed_copper",
        ) &&
        errors.length > 0 &&
        errors.every((error): boolean => error.drc_source === "fixed_copper")
      ) {
        decision = state
        break
      }
    }
    solver.step()
  }
  expect(solver.failed).toBe(false)
  expect(decision).toBeDefined()
  // This phase follows the actual merge and physical candidate guards.
  const currentRoutes = decision!.context.currentRoutes
  const proposedRoutes = decision!.candidateRoutes
  const currentReference = decision!.context.currentErrors
  const candidateReference = Array.isArray(decision!.candidateReference)
    ? decision!.candidateReference
    : decision!.candidateReference.errors
  solver.step()
  const accepted = decision!.context.currentRoutes === proposedRoutes
  expect(accepted).toBe(true)
  expect(fixture).toEqual(original)
  expect(
    proposedRoutes.find(
      (route): boolean => route.connectionName === "source_net_40",
    ),
  ).toEqual(
    currentRoutes.find(
      (route): boolean => route.connectionName === "source_net_40",
    ),
  )
  const convert = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    connMap,
  })
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: srj.minTraceToPadEdgeClearance,
      viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  const currentFull = evaluate(convert(currentRoutes)).errors
  const candidateFull = evaluate(convert(proposedRoutes)).errors
  expect(candidateFull.length).toBeLessThan(currentFull.length)
  const fixedCount = (errors: DrcError[]): number =>
    errors.filter((error): boolean => error.drc_source === "fixed_copper")
      .length
  expect(fixedCount(candidateFull)).toBe(fixedCount(currentFull))

  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    circles: [],
    lines: [],
    texts: [],
    rects: [
      {
        center: { x: 11.1, y: 11.1 },
        width: 22.2,
        height: 25,
        fill: "transparent",
        stroke: "transparent",
      },
    ],
  }
  const label = (
    x: number,
    y: number,
    text: string,
    size = 0.31,
    color = "#334155",
  ): void => {
    graphics.texts!.push({
      x,
      y,
      text,
      fontSize: size,
      anchorSide: "top_left",
      color,
    })
  }
  const color = (route: HighDensityRoute): string =>
    route.connectionName === "source_net_40"
      ? "#2563eb"
      : route.connectionName === "source_net_41"
        ? "#d97706"
        : "#9333ea"
  for (const [index, drawing] of [currentRoutes, proposedRoutes].entries()) {
    const offset = index * 6.1
    const point = (p: Point): Point => ({
      x: p.x + 23 + offset,
      y: p.y + 28,
    })
    label(
      offset,
      20.6,
      index === 0 ? "Current native board" : "Proposed regional board",
      0.38,
      "#0f172a",
    )
    for (const obstacle of srj.obstacles) {
      if (obstacle.shape === "circle") {
        graphics.circles!.push({
          center: point(obstacle.center),
          radius: obstacle.width / 2,
          fill: "#ef44443a",
          stroke: "#dc2626",
        })
      } else {
        graphics.rects!.push({
          center: point(obstacle.center),
          width: obstacle.width,
          height: obstacle.height,
          fill: "#ef44444a",
          stroke: "#dc2626",
        })
      }
    }
    for (const route of drawing) {
      for (let n = 1; n < route.route.length; n++) {
        const a = route.route[n - 1]!
        const b = route.route[n]!
        if (a.z !== b.z) {
          graphics.circles!.push({
            center: point(a),
            radius: route.viaDiameter / 2,
            fill: `${color(route)}28`,
            stroke: color(route),
          })
        } else {
          graphics.lines!.push({
            points: [point(a), point(b)],
            strokeColor: color(route),
            strokeWidth: Math.max(
              a.traceThickness ?? route.traceThickness,
              b.traceThickness ?? route.traceThickness,
            ),
            strokeDash: a.z === 0 ? undefined : [0.18, 0.1],
          })
        }
      }
    }
  }
  const phase = (errors: DrcError[]): string =>
    errors.length === 0
      ? "clear"
      : errors.some((error): boolean => error.drc_source !== "fixed_copper")
        ? "circuit errors"
        : "fixed copper"
  label(0, 23.1, "Glider · native regional repair priorities", 0.56, "#0f172a")
  label(
    0,
    22.15,
    "3 actual DDR routes · 2 earlier wires · " +
      "3 native BGA pads · original rules",
    0.34,
  )
  label(12.4, 19.5, "Actual native proposal", 0.43, "#0f172a")
  label(
    12.4,
    18.65,
    `Complete DRC: ${currentFull.length} to ${candidateFull.length}`,
    0.37,
  )
  label(
    12.4,
    17.9,
    `Compared count: ${currentReference.length} to ` +
      `${candidateReference.length}`,
    0.37,
  )
  label(12.4, 17.15, phase(currentReference), 0.33)
  label(12.4, 16.5, `then ${phase(candidateReference)}`, 0.33)
  label(12.4, 14.9, "Actual proposal decision", 0.43, "#0f172a")
  label(
    12.4,
    14.05,
    accepted ? "Accepted" : "Rejected",
    0.45,
    accepted ? "#15803d" : "#b45309",
  )
  label(
    12.4,
    13.2,
    `Inherited fixed errors: ${fixedCount(currentFull)} to ` +
      `${fixedCount(candidateFull)}`,
    0.35,
  )
  label(12.4, 12.45, "Existing physical guards passed", 0.32)
  label(12.4, 11.75, "One proposal; full routing stops here", 0.3)
  label(12.4, 9.8, "Blue DDR_040 · orange DDR_041", 0.3)
  label(12.4, 9.1, "Purple DDR_043", 0.3)
  label(12.4, 8.0, "Red bars: fixed DDR_035 / DDR_036", 0.3)
  label(12.4, 7.3, "Red disks: native BGA pads", 0.3)
  label(12.4, 6.2, "Top wires solid; inner wires dashed", 0.3)
  label(12.4, 5.5, "Via copper spans all 4 layers", 0.3)
  label(
    0,
    -0.9,
    `Trace ${srj.minTraceWidth} mm · via ${srj.minViaDiameter} mm · ` +
      `clearance ${srj.minTraceToPadEdgeClearance} mm · geometry in mm`,
    0.31,
  )
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1536,
      svgHeight: 1536,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

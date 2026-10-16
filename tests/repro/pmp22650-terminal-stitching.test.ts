import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type StitchInput = ConstructorParameters<
  typeof MultipleHighDensityRouteStitchSolver3
>[0]

type Pmp22650TerminalStitchingFixture = {
  board: "TI PMP22650"
  sample: "dataset-srj24 sample024"
  sameRootBridge: StitchInput
  coincidentLayerTerminals: StitchInput
  terminalRouteOrientation: StitchInput
}

const fixture = JSON.parse(
  gunzipSync(
    await Bun.file(
      new URL("./assets/pmp22650-terminal-stitching.json.gz", import.meta.url),
    ).bytes(),
  ).toString("utf8"),
) as Pmp22650TerminalStitchingFixture

const getInputRouteGraphics = (
  hdRoutes: HighDensityIntraNodeRoute[],
): GraphicsObject => ({
  title: `${fixture.board} ${fixture.sample} stitch fragments`,
  lines: hdRoutes.flatMap((route) =>
    route.route.slice(1).map((point, pointIndex) => {
      const previousPoint = route.route[pointIndex]!
      return {
        points: [previousPoint, point],
        strokeColor: previousPoint.z === 0 ? "#e11d48" : "#2563eb",
        strokeWidth: route.traceThickness,
        label: route.connectionName,
      }
    }),
  ),
  points: hdRoutes.flatMap((route) => {
    const points: NonNullable<GraphicsObject["points"]> = []
    if (route.startPcbPortId) {
      points.push({
        ...route.route[0]!,
        color: "#111827",
        label: route.startPcbPortId,
      })
    }
    if (route.endPcbPortId) {
      points.push({
        ...route.route.at(-1)!,
        color: "#111827",
        label: route.endPcbPortId,
      })
    }
    return points
  }),
  circles: hdRoutes.flatMap((route) =>
    route.vias.map((via) => ({
      center: via,
      radius: route.viaDiameter / 2,
      fill: "#7c3aed",
    })),
  ),
  rects: [],
})

const runStitchSolver = (input: StitchInput) => {
  let solver: MultipleHighDensityRouteStitchSolver3 | undefined
  try {
    solver = new MultipleHighDensityRouteStitchSolver3(input)
    solver.solve()
    return { solver, error: solver.error }
  } catch (error) {
    return {
      solver,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const runTerminalOrientationSolver = (input: StitchInput) => {
  const connection = input.connections[0]!
  const topTerminal = connection.pointsToConnect.find(
    (point) => getConnectionPointLayer(point) === "top",
  )!
  const bottomTerminal = connection.pointsToConnect.find(
    (point) => getConnectionPointLayer(point) === "bottom",
  )!
  let solver: SingleHighDensityRouteStitchSolver3 | undefined

  try {
    solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: connection.name,
      hdRoutes: input.hdRoutes,
      start: {
        ...topTerminal,
        z: mapLayerNameToZ("top", input.layerCount),
      },
      end: {
        ...bottomTerminal,
        z: mapLayerNameToZ("bottom", input.layerCount),
      },
      defaultViaDiameter: input.defaultViaDiameter,
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: () => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    return { solver, error: solver.error }
  } catch (error) {
    return {
      solver,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const getResultGraphics = (
  solver:
    | MultipleHighDensityRouteStitchSolver3
    | SingleHighDensityRouteStitchSolver3
    | undefined,
  input: StitchInput,
) =>
  solver?.solved ? solver.visualize() : getInputRouteGraphics(input.hdRoutes)

test("PMP22650 sibling MST terminal stitching", () => {
  const result = runStitchSolver(fixture.sameRootBridge)
  const targetRoute = result.solver?.mergedHdRoutes.find(
    (route) => route.connectionName === "source_net_altium_pcb_385_mst101",
  )

  expect(result.error).toBeNull()
  expect(result.solver?.solved).toBe(true)
  expect(targetRoute?.startPcbPortId).toBe("pcb_port_altium_6999")
  expect(targetRoute?.endPcbPortId).toBe("pcb_port_altium_6477")
  expect(
    getResultGraphics(result.solver, fixture.sameRootBridge),
  ).toMatchGraphicsSvg(`${import.meta.path}-same-root-bridge`)
})

test("PMP22650 coincident layer terminal stitching", () => {
  const result = runStitchSolver(fixture.coincidentLayerTerminals)
  const targetRoute = result.solver?.mergedHdRoutes[0]

  expect(result.error).toBeNull()
  expect(result.solver?.solved).toBe(true)
  expect(
    new Set([targetRoute?.startPcbPortId, targetRoute?.endPcbPortId]),
  ).toEqual(new Set(["pcb_port_altium_7313", "pcb_port_altium_8623"]))
  expect(
    getResultGraphics(result.solver, fixture.coincidentLayerTerminals),
  ).toMatchGraphicsSvg(`${import.meta.path}-coincident-layer-terminals`)
})

test("PMP22650 terminal identity route orientation", () => {
  const result = runTerminalOrientationSolver(fixture.terminalRouteOrientation)
  const targetRoute = result.solver?.mergedHdRoute

  expect(result.error).toBeNull()
  expect(result.solver?.solved).toBe(true)
  expect(
    new Set([targetRoute?.startPcbPortId, targetRoute?.endPcbPortId]),
  ).toEqual(new Set(["pcb_port_altium_7312", "pcb_port_altium_8622"]))
  expect(
    getResultGraphics(result.solver, fixture.terminalRouteOrientation),
  ).toMatchGraphicsSvg(`${import.meta.path}-terminal-route-orientation`)
})

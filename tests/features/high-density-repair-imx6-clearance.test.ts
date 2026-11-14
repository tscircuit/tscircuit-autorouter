import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkPadTraceClearance,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
} from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import {
  applyNativeRepair,
  type NativeRepairFixture,
} from "tests/fixtures/applyNativeRepair"
import { createPipeline9TestRuntime } from "tests/fixtures/createPipeline9TestRuntime"

test("iMX6 DDR repair retains the native board copper", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/imx6-ddr-repair-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as NativeRepairFixture
  const { sample } = fixture
  const hdRoutes = [...sample.nodeHdRoutes, ...sample.fixedHdRoutes]
  const original = structuredClone(hdRoutes)
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [
      {
        ...sample.nodeWithPortPoints,
        capacityMeshNodeId: "imx6-cpu-ddr",
        availableZ: [0, 1, 2, 3, 4, 5],
        portPoints: sample.nodeHdRoutes.flatMap((route) =>
          [route.route[0]!, route.route.at(-1)!].map((point) => ({
            ...point,
            connectionName: route.connectionName,
          })),
        ),
      },
    ],
    hdRoutes,
    obstacles: sample.clearanceObstacles,
    repairMargin: sample.minClearance,
  })
  expect(solver.sampleEntries.map((entry) => entry.routeIndexes)).toEqual([
    [0, 1, 2],
  ])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(hdRoutes).toEqual(original)
  const repaired = solver.getOutput()
  const runtime = createPipeline9TestRuntime(1)
  try {
    const workerSolver = new Pipeline4HighDensityRepairSolver(
      ...solver.getConstructorParams(),
    )
    await workerSolver.solveAsync(runtime)
    expect(workerSolver.solved).toBe(true)
    expect(workerSolver.getOutput()).toEqual(repaired)
  } finally {
    await runtime.dispose()
  }
  expect(repaired.slice(sample.nodeHdRoutes.length)).toEqual(
    sample.fixedHdRoutes,
  )
  for (const [index, route] of sample.nodeHdRoutes.entries()) {
    expect(
      [repaired[index]!.route[0]!, repaired[index]!.route.at(-1)!].map(
        ({ x, y, z }) => ({ x, y, z }),
      ),
    ).toEqual(
      [route.route[0]!, route.route.at(-1)!].map(({ x, y, z }) => ({
        x,
        y,
        z,
      })),
    )
  }
  const circuit = applyNativeRepair(
    fixture,
    repaired.slice(0, sample.nodeHdRoutes.length),
  )
  expect(
    circuit.filter((element) => element.type === "source_component"),
  ).toHaveLength(498)
  expect(
    circuit.filter((element) => element.type === "source_trace"),
  ).toHaveLength(588)
  const options = { minClearance: sample.minClearance }
  expect(checkViaTraceClearance(circuit, options)).toHaveLength(4)
  expect(checkViasInPads(circuit)).toHaveLength(1)
  for (const check of [
    checkEachPcbTraceNonOverlapping,
    checkPadTraceClearance,
    checkViaPadClearance,
    checkDifferentNetViaSpacing,
    checkTracesAreContiguous,
    checkHoleTraceClearance,
  ]) {
    expect(check(circuit, options)).toHaveLength(0)
  }
  const renderOptions = {
    width: 1400,
    height: 1000,
    backgroundColor: "white",
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  }
  await expect(
    convertCircuitJsonToPcbSvg(circuit, renderOptions),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
  const viewport = { minX: -5.6, maxX: -3.8, minY: -13.05, maxY: -11.7 }
  const focusedCircuit = circuit.map((element) =>
    element.type === "pcb_board"
      ? {
          ...element,
          center: {
            x: (viewport.minX + viewport.maxX) / 2,
            y: (viewport.minY + viewport.maxY) / 2,
          },
          width: viewport.maxX - viewport.minX,
          height: viewport.maxY - viewport.minY,
          outline: undefined,
        }
      : element,
  )
  await expect(
    convertCircuitJsonToPcbSvg(focusedCircuit, {
      ...renderOptions,
      drawPaddingOutsideBoard: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "ba2-address",
    tolerance: 0,
  })
})

import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import type { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { multiTerminalDifferentialPair } from "../fixtures/multiTerminalDifferentialPair"

test("Pipeline9 routes a connector/ESD/MCU differential pair", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(multiTerminalDifferentialPair),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const step = solver.pipelineDef.find(
    (step): boolean => step.solverName === "lengthMatchingPostProcessingSolver",
  )!
  const [params] = step.getConstructorParams(solver) as ConstructorParameters<typeof LengthMatchingPostProcessingSolver>
  expect(params.differentialPairs).toHaveLength(2)
  for (const pair of params.differentialPairs) {
    expect(pair).toMatchObject({
      lengthTolerance: 0.05,
      maxUncoupledLength: 3,
      minimumCenterlineDistance: expect.closeTo(0.45),
      maximumCenterlineDistance: expect.closeTo(0.45),
    })
    const routes = solver.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes
    const pairedRoutes = pair.connectionNames.map((name: string): HighDensityRoute =>
      routes.find((route): boolean => route.connectionName === name)!,
    )
    const lengths = pairedRoutes.map((route): number =>
      route.route.slice(1).reduce((length, point, index): number => {
        const previous = route.route[index]!
        return length + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, 0),
    )
    expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(pair.lengthTolerance)
    const endpoints = pairedRoutes.map((route): number[] =>
      [route.route[0]!.x, route.route.at(-1)!.x].sort((a, b): number => a - b),
    )
    expect(endpoints[0]).toEqual(endpoints[1])
    expect([10, 20]).toContain(endpoints[0]![1]!)
    // Terminals stay 1mm apart; both segment interiors must be recoupled.
    expect(pairedRoutes[0]!.route.length).toBeGreaterThan(2)
    for (const point of pairedRoutes[0]!.route.slice(1, -1)) {
      expect(pairedRoutes[1]!.route.some((other): boolean =>
        Math.abs(point.x - other.x) < 1e-6 &&
        Math.abs(Math.abs(point.y - other.y) - 0.45) < 1e-6,
      )).toBe(true)
    }
    for (const { route } of pairedRoutes) {
      const startEscape = Math.hypot(route[1]!.x - route[0]!.x, route[1]!.y - route[0]!.y)
      const endEscape = Math.hypot(route.at(-1)!.x - route.at(-2)!.x, route.at(-1)!.y - route.at(-2)!.y)
      expect(startEscape + endEscape).toBeLessThanOrEqual(3)
    }
  }
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(4)
  expect(evaluateRelaxedDrc({
    inputSrj: multiTerminalDifferentialPair,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }).errors).toHaveLength(0)
  for (const connection of multiTerminalDifferentialPair.connections) {
    const signalTraces = traces.filter(
      (trace): boolean => trace.connection_name === connection.name,
    )
    expect(signalTraces).toHaveLength(2)
    for (const point of connection.pointsToConnect) {
      expect(signalTraces.some((trace): boolean => trace.route.some(
        (wire): boolean => wire.route_type === "wire" &&
          Math.hypot(wire.x - point.x, wire.y - point.y) < 1e-6,
      ))).toBe(true)
    }
  }
  expect(solver.netToPointPairsSolver!.newConnections).toHaveLength(4)
  expect(solver.effortCleanupSolver!.getOutput()).toHaveLength(4)
  await expect(
    getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(
        {
          ...multiTerminalDifferentialPair,
          traces: solver.getNewTracesBeforePowerExpansion(),
        },
        { traceColorMode: "net" },
      ),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

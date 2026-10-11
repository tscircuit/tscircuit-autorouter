import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObservedMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ObservedMultiSimplifiedPathSolver"
import { ParallelPathQueryCertifier } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathQueryCertifier"
import type { ParallelPathQueryFootprint } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Params = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0]
type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]

function getIndex(solver: MultiSimplifiedPathSolver): GeometryIndex {
  return (solver as unknown as { geometryIndex: GeometryIndex }).geometryIndex
}

function route(name: string, points: Array<[number, number, number]>, via?: [number, number]): HighDensityRoute {
  return { connectionName: name, traceThickness: 0.15, viaDiameter: 0.3,
    route: points.map(([x, y, z]) => ({ x, y, z })),
    vias: via ? [{ x: via[0], y: via[1] }] : [] }
}

function runOneRoute(solver: MultiSimplifiedPathSolver): number {
  const start = solver.iterations
  solver.step()
  while (solver.activeSubSolver && !solver.failed) solver.step()
  if (solver.failed) throw new Error(`Native route failed: ${solver.error}`)
  return solver.iterations - start
}

function footprint(valid: boolean, immutableObstacleFailure = false): ParallelPathQueryFootprint {
  return { complete: true, nativeQueryCount: 1, obstacleWitnessTests: 0,
    queries: [{ start: { x: -0.8, y: 0, z: 0 }, end: { x: 0.8, y: 0, z: 0 },
      valid, immutableObstacleFailure }] }
}

test("native filtered primitive certificates preserve every observed route decision and reject changed witnesses", (): void => {
  let seed = 0x415370
  const random = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x1_0000_0000
  }
  let certified = 0
  let rejected = 0
  const fixtures: Params[] = []
  for (let fixture = 0; fixture < 32; fixture++) {
    const routes: HighDensityRoute[] = []
    for (let index = 0; index < 8; index++) {
      const x = Math.floor(random() * 16) / 4 - 2
      const y = Math.floor(random() * 16) / 4 - 2
      const z = Math.floor(random() * 2)
      routes.push(route(`net-${index}`, [[x - 1, y, z], [x - 0.5, y + 0.5, z],
        [x + 0.5, y + 0.5, z], [x + 1, y, z]], index % 5 === 0 ? [x, y + 0.5] : undefined))
    }
    if (fixture % 4 === 0) routes[6] = routes[2]!
    fixtures.push({ unsimplifiedHdRoutes: routes, connMap: new ConnectivityMap({}), obstacles: [
      { type: "rect", center: { x: 0.2, y: 0.3 }, width: 0.3, height: 0.5,
        layers: ["top"], connectedTo: [] },
    ], otherHdRoutes: [route("fixed", [[-2.5, -1.75, 1], [2.5, -1.75, 1]])] })
  }
  for (const config of fixtures) {
    const native = new MultiSimplifiedPathSolver(config)
    native.solve()
    const observed = new ObservedMultiSimplifiedPathSolver(config)
    const nativeRouteSteps: number[] = []
    for (let index = 0; index < config.unsimplifiedHdRoutes.length; index++) {
      observed.beginObservedRoute()
      nativeRouteSteps.push(runOneRoute(observed))
    }
    observed.step()
    expect(observed.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
    expect(observed.iterations).toBe(native.iterations)
    expect(observed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    const original = new MultiSimplifiedPathSolver(config)
    const current = new MultiSimplifiedPathSolver(config)
    const certifier = new ParallelPathQueryCertifier(original, current)
    for (let index = 0; index < config.unsimplifiedHdRoutes.length; index++) {
      const prefix = Math.max(0, index - 3)
      const speculative = new ObservedMultiSimplifiedPathSolver(config)
      speculative.currentUnsimplifiedHdRouteIndex = index
      speculative.simplifiedHdRoutes = config.unsimplifiedHdRoutes.slice(0, index).map((input, peer) =>
        peer < prefix ? native.simplifiedHdRoutes[peer]! : input)
      for (let peer = 0; peer < prefix; peer++) getIndex(speculative).replaceRoute(peer, native.simplifiedHdRoutes[peer]!)
      speculative.beginObservedRoute()
      const candidateSteps = runOneRoute(speculative)
      const certificate = certifier.certify(index, prefix, speculative.footprint)
      if (certificate.certified) {
        certified++
        expect(speculative.simplifiedHdRoutes[index]).toEqual(native.simplifiedHdRoutes[index])
        expect(candidateSteps).toBe(nativeRouteSteps[index])
      } else rejected++
      expect(runOneRoute(current)).toBe(nativeRouteSteps[index])
      expect(current.simplifiedHdRoutes[index]).toEqual(native.simplifiedHdRoutes[index])
    }
    current.step()
    expect(current.iterations).toBe(native.iterations)
  }
  expect(certified).toBeGreaterThan(100)
  expect(rejected).toBeGreaterThan(0)

  const subject = route("subject", [[-1, 0, 0], [1, 0, 0]])
  const previous = route("previous", [[-1, 1, 0], [1, 1, 0]])
  const config: Params = { unsimplifiedHdRoutes: [previous, subject], obstacles: [], connMap: new ConnectivityMap({}) }
  const original = new MultiSimplifiedPathSolver(config)
  const current = new MultiSimplifiedPathSolver(config)
  const certifier = new ParallelPathQueryCertifier(original, current)
  const publish = (value: HighDensityRoute): void => {
    current.simplifiedHdRoutes = [value]
    current.currentUnsimplifiedHdRouteIndex = 1
    getIndex(current).replaceRoute(0, value)
  }
  publish(route("previous", [[-1, 0.2, 0], [1, 0.2, 0]]))
  expect(certifier.certify(1, 0, footprint(true)).certified).toBe(false)
  expect(certifier.certify(1, 0, footprint(false, true)).certified).toBe(true)
  publish(route("previous", [[-1, 0.25, 0], [1, 0.25, 0]]))
  expect(certifier.certify(1, 0, footprint(true)).certified).toBe(true)
  publish(route("previous", [[-1, 0.2, 1], [1, 0.2, 1]]))
  expect(certifier.certify(1, 0, footprint(true)).certified).toBe(true)
  publish(route("previous", [[-1, 0.2, 1], [1, 0.2, 1]], [0, 0.2]))
  expect(certifier.certify(1, 0, footprint(true)).certified).toBe(false)
  publish(route("subject", [[-1, 0.2, 0], [1, 0.2, 0]]))
  expect(certifier.certify(1, 0, footprint(true)).certified).toBe(true)
  publish(route("previous", [[-1, 0.2, 0], [1, 0.2, 0]]))
  expect(certifier.certify(1, 0, { ...footprint(true), complete: false }).certified).toBe(false)
  expect(() => certifier.certify(1, -1, footprint(true))).toThrow("Invalid path query")
  const signedZero = footprint(true)
  signedZero.queries[0]!.start.y = -0
  expect(certifier.certify(1, 0, signedZero).certified).toBe(false)
  const nonfinite = footprint(true)
  nonfinite.queries[0]!.start.y = Number.NaN
  expect(certifier.certify(1, 0, nonfinite).certified).toBe(false)
})

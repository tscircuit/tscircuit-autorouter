import { expect } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

export const makeLazyHdSyntheticNode = (seed: number): NodeWithPortPoints => {
  const width = 1.2 + (seed % 5) * 0.11
  const height = 1.3 + (seed % 7) * 0.09
  const portPoints: NodeWithPortPoints["portPoints"] = []
  for (let connection = 0; connection < 1 + seed % 3; connection++) {
    const angle = (Math.PI * connection) / (1 + seed % 3)
    const x = Math.cos(angle) * width * 0.46
    const y = Math.sin(angle) * height * 0.46
    portPoints.push(
      { connectionName: `net${connection}`, rootConnectionName: `root${connection}`, portPointId: `s${connection}`, nextPortPointId: `e${connection}`, x: -x, y: -y, z: 0 },
      { connectionName: `net${connection}`, rootConnectionName: `root${connection}`, portPointId: `e${connection}`, prevPortPointId: `s${connection}`, x, y, z: seed % 2 },
    )
  }
  return { capacityMeshNodeId: `synthetic-lazy-${seed}`, center: { x: 0, y: 0 }, width, height, availableZ: [0, 1], portPoints }
}

export const makeLazyHdPortfolio = (
  node: NodeWithPortPoints,
  flag: boolean | undefined,
  priority: boolean = true,
): PortfolioSingleIntraNodeSolver => {
  return new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    experimentLazyHdCandidates: flag,
    priorityDagSearch: priority,
    priorityDiagnostics: {},
    cacheProvider: new InMemoryCache(),
    viaDiameter: 0.25,
    traceWidth: 0.1,
    effort: 1,
    layerCount: 2,
    enableNegotiatedSearch: true,
  })
}

export const expectNativeHdStateEqual = (
  native: HighDensitySolverA01 | HighDensitySolverA03,
  lazy: HighDensitySolverA01 | HighDensitySolverA03,
): void => {
  for (const key of Object.keys(native)) {
    expect((lazy as any)[key]).toEqual((native as any)[key])
  }
  expect(lazy.getConstructorParams()).toEqual(native.getConstructorParams())
  expect(lazy.getOutput()).toEqual(native.getOutput())
  expect(lazy.getSolverName()).toBe(native.getSolverName())
}

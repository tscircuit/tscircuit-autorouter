import { beforeAll, expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { addSolderjumperViaCountToSvg } from "../fixtures/addSolderjumperViaCountToSvg"
import fixture from "../fixtures/assets/solderjumper-central-node.json"

type SerializedPortfolioParams = Omit<
  ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0],
  "connMap"
> & { connMap: { netMap: Record<string, string[]> } }

let viaCount: number

beforeAll(async (): Promise<void> => {
  // Exact cmn_0 constructor input from the normal Core solderjumper-circuit
  // fixture. No recorded routes are replayed; all four paths are solved here.
  const { connMap, ...params } = structuredClone(
    fixture,
  ) as SerializedPortfolioParams
  const originalNode = structuredClone(params.nodeWithPortPoints)
  const solver = new PortfolioSingleIntraNodeSolver({
    ...params,
    connMap: new ConnectivityMap(connMap.netMap),
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.solvedRoutes).toHaveLength(4)
  expect(params.nodeWithPortPoints).toEqual(originalNode)
  expect(originalNode.portPoints).toHaveLength(8)

  for (const pair of originalNode.portPointsInPairs!) {
    const route = solver.solvedRoutes.find(
      (candidate) => candidate.connectionName === pair[0].connectionName,
    )!
    const endpoints = [route.route[0]!, route.route.at(-1)!]
    for (const terminal of pair) {
      expect(
        endpoints.some(
          (point) =>
            Math.abs(point.x - terminal.x) < 1e-6 &&
            Math.abs(point.y - terminal.y) < 1e-6 &&
            point.z === terminal.z,
        ),
      ).toBeTrue()
    }
  }
  viaCount = solver.solvedRoutes.reduce(
    (total, route) => total + route.vias.length,
    0,
  )
  // Keep snapshots outside the expected failure so rendering failures stay red.
  await expect(
    addSolderjumperViaCountToSvg(
      getSvgFromGraphicsObject(solver.visualize(), {
        backgroundColor: "white",
      }),
      viaCount,
    ),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

test(
  "the real solderjumper node keeps the previous four-via routing quality",
  (): void => {
    expect(viaCount).toBeLessThanOrEqual(4)
  },
)

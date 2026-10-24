import { expect, test } from "bun:test"
import type { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("native witness portfolio consumes bounded replay debt and preserves ordinary completion checks", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "shared", center: { x: 5, y: 5 }, width: 10, height: 10,
    availableZ: [0, 1], portPoints: [
      { x: 1, y: 1, z: 0, connectionName: "wire", rootConnectionName: "root", pcb_port_id: "A" },
      { x: 8, y: 8, z: 0, connectionName: "wire", rootConnectionName: "root", pcb_port_id: "B" },
      { x: 1, y: 9, z: 0, connectionName: "far", rootConnectionName: "other" },
      { x: 9, y: 9, z: 0, connectionName: "far", rootConnectionName: "other" },
    ] }
  const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node, enableNativeRouteWitnessReuse: true,
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.1, captureSearchDebug: false })
  const source = portfolio.generateSolver({ SHUFFLE_SEED: 0 }) as CachedIntraNodeRouteSolver
  source.cacheProvider = null
  source.solve()
  expect(source.solved).toBe(true)
  expect(portfolio.nativeRouteWitnessBroker!.diagnostics.stores).toBeGreaterThan(0)
  const replay = portfolio.generateSolver({ SHUFFLE_SEED: 0 }) as CachedIntraNodeRouteSolver
  replay.cacheProvider = null
  expect(replay.nodeWithPortPoints).toBe(source.nodeWithPortPoints)
  expect(Object.isFrozen(replay.nodeWithPortPoints)).toBe(true)
  let postrouteChecks = 0
  const exposed = replay as unknown as { getFirstSolvedViaTraceConflict: () => unknown }
  const original = exposed.getFirstSolvedViaTraceConflict.bind(replay)
  exposed.getFirstSolvedViaTraceConflict = (): unknown => { postrouteChecks++; return original() }
  replay.solve()
  expect(replay.solved).toBe(true)
  expect(replay.solvedRoutes).toEqual(source.solvedRoutes)
  expect(replay.iterations).toBeLessThan(source.iterations)
  expect(replay.iterations).toBeGreaterThan(replay.solvedRoutes.length)
  expect(postrouteChecks).toBeGreaterThan(0)
  expect(portfolio.nativeRouteWitnessBroker!.diagnostics.reusedCompletedRoutes).toBeGreaterThan(0)
  expect(portfolio.nativeRouteWitnessBroker!.diagnostics.logicalWorkUnits).toBeGreaterThan(0)
  const isolated = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node, enableNativeRouteWitnessReuse: true })
  expect(isolated.nativeRouteWitnessBroker).not.toBe(portfolio.nativeRouteWitnessBroker)
  expect(isolated.nativeRouteWitnessBroker!.diagnostics.stores).toBe(0)
  const disabled = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node })
  expect(disabled.nativeRouteWitnessBroker).toBeUndefined()
})

import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { createPipeline9RegularNodeSolverFromCanonicalNode, Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getPipeline9PhysicalObstacleOwner, getPipeline9PhysicalOwnership, getPipeline9PhysicalRouteOwner, type Pipeline9DerivedPhysicalRouteAlias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { loadCapturedForestRegion } from "../fixtures/physical-forest-regional/loadCapturedForestRegion"

type Cell = { row: number; col: number; z: number }
type StrictCapturedFixture = {
  provenance: {
    legacyCaptureUncompressedSha256: string
    normalizedScenarioJsonStringifySha256: string
    sourcePcbDocSha256: string
  }
  originalSrj: SimpleRouteJson & { sourcePcbDocSha256: string }
  derivedRouteAliases: Pipeline9DerivedPhysicalRouteAlias[]
  promotedNode: NodeWithPortPoints
  unsafeOldWinnerRoutes: HighDensityIntraNodeRoute[]
  feasibleWitness: {
    routes: HighDensityIntraNodeRoute[]
    grid: { rows: number; cols: number; rawCellSize: number }
    cellsByConnectionName: Record<string, Cell[]>
  }
}

test("strict original cmn42 context rejects the old winner and exposes a known search limitation despite a feasible A01-grid route", (): void => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/pipeline9-native-world-guards/cmn42-strict-context-known-search-limitation.json", import.meta.url), "utf8")) as StrictCapturedFixture
  const captured = loadCapturedForestRegion("cmn_42")
  expect(fixture.provenance.legacyCaptureUncompressedSha256).toBe("3762a5269614607c3eb87aae1959fdffe8e0c3da99509140cb74e00e8ffa2cbf")
  expect(createHash("sha256").update(JSON.stringify(fixture.originalSrj)).digest("hex")).toBe(fixture.provenance.normalizedScenarioJsonStringifySha256)
  expect(fixture.provenance.normalizedScenarioJsonStringifySha256).toBe("e93af43bdcfe9a62705d71c3eba553a2ada76f004eb565912d93dfd5a3bcc4c6")
  expect(fixture.originalSrj.sourcePcbDocSha256).toBe(fixture.provenance.sourcePcbDocSha256)
  expect(fixture.originalSrj.connections).toHaveLength(23)
  expect(fixture.originalSrj.obstacles).toHaveLength(80)
  const connMap = new ConnectivityMap(captured.connectivityNetMap)
  const physicalOwnership = getPipeline9PhysicalOwnership({
    originalSrj: fixture.originalSrj, derivedRouteAliases: fixture.derivedRouteAliases, routingConnMap: connMap,
  })
  expect(physicalOwnership.diagnostics.unknownDerivedAliases).toEqual([])
  expect(physicalOwnership.diagnostics.ambiguousDerivedAliases).toEqual([])
  const owners = fixture.feasibleWitness.routes.map((route) => getPipeline9PhysicalRouteOwner(physicalOwnership, route))
  expect(owners.every((owner) => owner !== undefined)).toBeTrue()
  expect(new Set(owners).size).toBe(3)
  for (const alias of fixture.derivedRouteAliases) {
    expect(physicalOwnership.connectionOwners[alias.connectionName]).toBe(physicalOwnership.connectionOwners[alias.parentConnectionName!])
  }
  const rules = {
    connMap, physicalOwnership, layerCount: captured.layerCount,
    allowBlindAndBuriedVias: captured.allowBlindAndBuriedVias,
    traceClearance: fixture.originalSrj.minTraceToPadEdgeClearance ?? 0.1,
    traceToPadClearance: fixture.originalSrj.minTraceToPadEdgeClearance,
    traceToHoleClearance: fixture.originalSrj.minTraceToHoleEdgeClearance,
    viaHoleDiameter: captured.viaHoleDiameter!,
    minViaHoleEdgeToViaHoleEdgeClearance: captured.minViaHoleEdgeToViaHoleEdgeClearance!,
    boardObstacles: fixture.originalSrj.obstacles,
    viaToPadClearance: fixture.originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1,
  }
  const foreignTopPad = fixture.originalSrj.obstacles.find((obstacle) => obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_altium_338")!
  const unsafeSignal = fixture.unsafeOldWinnerRoutes.find((route) => route.connectionName === "source_net_altium_pcb_13_mst1")!
  expect(getPipeline9PhysicalObstacleOwner(physicalOwnership, foreignTopPad)).not.toBe(getPipeline9PhysicalRouteOwner(physicalOwnership, unsafeSignal))
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...rules, routes: [unsafeSignal], boardObstacles: [foreignTopPad] })).toBeFalse()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...rules, routes: fixture.feasibleWitness.routes })).toBeTrue()
  const regular = createPipeline9RegularNodeSolverFromCanonicalNode({
    nodeWithPortPoints: fixture.promotedNode, connMap, physicalOwnership, colorMap: captured.colorMap ?? {},
    obstacles: captured.obstacles, physicalBoardObstacles: fixture.originalSrj.obstacles,
    viaDiameter: captured.viaDiameter, viaHoleDiameter: captured.viaHoleDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: captured.minViaHoleEdgeToViaHoleEdgeClearance,
    traceWidth: captured.traceWidth, obstacleMargin: captured.obstacleMargin, effort: captured.effort,
    nodePfById: {}, layerCount: captured.layerCount, allowBlindAndBuriedVias: captured.allowBlindAndBuriedVias,
    physicalTraceClearance: rules.traceClearance, priorityDagSearch: true, cacheProvider: null,
  })
  expect(regular.solutionValidator!(fixture.unsafeOldWinnerRoutes)).toBeFalse()
  expect(regular.solutionValidator!(fixture.feasibleWitness.routes)).toBeTrue()

  // Read the real backend's grid and via zone; the witness is never installed
  // as a route, search node, occupancy map, cache entry, or solver result.
  const grid = new HighDensitySolverA01({ nodeWithPortPoints: fixture.promotedNode,
    cellSizeMm: 0.1, viaDiameter: captured.viaDiameter, viaMinDistFromBorder: captured.viaDiameter / 2,
    traceThickness: captured.traceWidth, traceMargin: 0.1, effort: captured.effort })
  grid.step()
  expect(Reflect.get(grid, "rows")).toBe(fixture.feasibleWitness.grid.rows)
  expect(Reflect.get(grid, "cols")).toBe(fixture.feasibleWitness.grid.cols)
  const transform = Reflect.get(grid, "gridToBoundsTransform")
  const origin = Reflect.get(grid, "gridOrigin") as { x: number; y: number }
  const pointToCell = Reflect.get(grid, "pointToCell") as (point: { x: number; y: number; z: number }) => Cell
  for (const route of fixture.feasibleWitness.routes) {
    const cells = fixture.feasibleWitness.cellsByConnectionName[route.connectionName]!
    const terminals = fixture.promotedNode.portPoints.filter((point) => point.connectionName === route.connectionName)
    expect(route.route[0]).toMatchObject({ x: terminals[0]!.x, y: terminals[0]!.y, z: terminals[0]!.z })
    expect(route.route.at(-1)).toMatchObject({ x: terminals[1]!.x, y: terminals[1]!.y, z: terminals[1]!.z })
    expect(pointToCell.call(grid, route.route[0]!)).toEqual(cells[0]!)
    expect(pointToCell.call(grid, route.route.at(-1)!)).toEqual(cells.at(-1)!)
    for (let index = 1; index < cells.length; index++) {
      const previous = cells[index - 1]!, cell = cells[index]!
      if (previous.z !== cell.z) {
        expect(cell.col).toBe(previous.col)
        expect(cell.row).toBe(previous.row)
        expect(cell.col).toBeGreaterThanOrEqual(Reflect.get(grid, "minViaCol"))
        expect(cell.col).toBeLessThanOrEqual(Reflect.get(grid, "maxViaCol"))
        expect(cell.row).toBeGreaterThanOrEqual(Reflect.get(grid, "minViaRow"))
        expect(cell.row).toBeLessThanOrEqual(Reflect.get(grid, "maxViaRow"))
      } else {
        expect(Math.max(Math.abs(cell.row - previous.row), Math.abs(cell.col - previous.col))).toBe(1)
      }
      if (index === cells.length - 1) continue
      const x = origin.x + (cell.col + 0.5) * fixture.feasibleWitness.grid.rawCellSize
      const y = origin.y + (cell.row + 0.5) * fixture.feasibleWitness.grid.rawCellSize
      expect(Math.abs(route.route[index]!.x - (transform.a! * x + transform.b! * y + transform.c!))).toBeLessThan(1e-10)
      expect(Math.abs(route.route[index]!.y - (transform.d! * x + transform.e! * y + transform.f!))).toBeLessThan(1e-10)
    }
  }

  // This is the unchanged captured search, now supplied the complete original
  // context. Its bounded failure must remain visible rather than publishing
  // the old invalid winner or substituting the feasible hand construction.
  const strict = new Pipeline9HighDensitySolver({ ...structuredClone(captured), connMap,
    useNativeRegionalRouting: true, physicalOwnership, physicalBoardObstacles: fixture.originalSrj.obstacles,
    physicalTraceClearance: rules.traceClearance, cacheProvider: null })
  expect(strict.MAX_ITERATIONS).toBe(100e6 * captured.effort)
  strict.solve()
  expect(strict.solved).toBeFalse()
  expect(strict.failed).toBeTrue()
  expect(strict.error).toContain("regional fallback failed")
  expect(strict.stats.solvedNodeCount).toBe(0)
  expect(strict.benchmarkDiagnosticCounters.regionalNativeRouteInstances).toBeGreaterThan(0)
})

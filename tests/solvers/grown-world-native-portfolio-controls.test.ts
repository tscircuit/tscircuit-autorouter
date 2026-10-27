import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { CompletedCopperWorldIndex } from "../../lib/solvers/HighDensitySolver/completedCopperWorldIndex"
import { createMandatoryPortPointIndex } from "../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("grown WORLD routing retains existing native portfolio policies and fixed physical context without external reseeds", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "policy", center: { x: 10, y: 20 },
    width: 1, height: 2, availableZ: [0, 1, 2, 3, 4, 5, 6, 7], portPoints: [
      { x: 9.5, y: 20, z: 0, connectionName: "A" },
      { x: 10.5, y: 20, z: 7, connectionName: "A" },
      { x: 10, y: 19, z: 2, connectionName: "B" },
      { x: 10, y: 21, z: 5, connectionName: "B" },
    ] }
  const before = JSON.stringify(node)
  const ledger = new CompletedCopperWorldIndex({ layerCount: 8, allowBlindAndBuriedVias: false, traceClearance: 0.1 })
  const fixed = createMandatoryPortPointIndex([node])
  const params = { nodeWithPortPoints: node, obstacles: [], layerCount: 8,
    allowBlindAndBuriedVias: false, traceWidth: 0.1, viaDiameter: 0.3,
    traceToPadClearance: 0.1, traceToHoleClearance: 0.2, viaToPadClearance: 0.1,
    priorityDagSearch: true, enableNegotiatedSearch: true, captureSearchDebug: false,
    mandatoryPortPointIndex: fixed, routedPeerWorldIndex: ledger }
  const create = (grow: GrowShrinkHighDensityIntraNodeSolver): PortfolioSingleIntraNodeSolver => {
    // Exercise the real growth-attempt constructor without spending the portfolio's search budget.
    ;(grow as unknown as { createActiveSubSolver(): void }).createActiveSubSolver()
    expect(grow.activeSubSolver).toBeInstanceOf(PortfolioSingleIntraNodeSolver)
    return grow.activeSubSolver as PortfolioSingleIntraNodeSolver
  }
  const first = create(new GrowShrinkHighDensityIntraNodeSolver(params))
  const original = new PortfolioSingleIntraNodeSolver(params)
  expect(first.getCombinationDefs()).toEqual(original.getCombinationDefs())
  expect(first.constructorParams.nativeGridOnly).toBeUndefined()
  expect(first.getCombinationDefs().some((g) => g.includes("highDensityA01"))).toBe(true)
  expect(first.getCombinationDefs().some((g) => g.includes("closedFormSingleTrace"))).toBe(true)

  const grow = new GrowShrinkHighDensityIntraNodeSolver(params)
  grow.scaleFactor = 8
  const grown = create(grow)
  expect(grown.constructorParams.nativeGridOnly).toBe(true)
  expect(grown.constructorParams.nodeWithPortPoints).toBe(node)
  expect(grown.constructorParams.nodeWithPortPoints.portPoints).toBe(node.portPoints)
  expect(grown.constructorParams.routingBounds).toEqual({ minX: 6, maxX: 14, minY: 12, maxY: 28 })
  expect(grown.constructorParams.priorityCoordinateScale).toBe(1)
  expect(grown.constructorParams.routedPeerWorldIndex).toBe(ledger)
  expect(grown.constructorParams.mandatoryPortPointIndex).toBe(fixed)
  const native = new Set(["majorCombinations", "noVias", "orderings50", "flipTraceAlignmentDirection"])
  expect(grown.getCombinationDefs()).toEqual(original.getCombinationDefs().filter(([name]) => native.has(name!)))
  expect(grown.getCombinationDefs().flat().some((name) => name.startsWith("highDensityA"))).toBe(false)
  expect(grown.getCombinationDefs().flat()).toContain("orderings6")
  expect(grown.getCombinationDefs().flat()).toContain("cellSizeFactor")
  expect(grown.getCombinationDefs().flat()).toContain("flipTraceAlignmentDirection")
  const definitions = grown.getHyperParameterDefs()
  const originalDefs = original.getHyperParameterDefs()
  for (const name of grown.getCombinationDefs().flat()) {
    expect(definitions.find((d) => d.name === name)).toEqual(originalDefs.find((d) => d.name === name))
  }
  const hyper = grown.getCombinationDefs().flatMap((group) =>
    grown.getHyperParameterCombinations(definitions.filter((d) => group.includes(d.name))))
  expect(hyper.length).toBeGreaterThan(1)
  expect(hyper.some((h) => h.CELL_SIZE_FACTOR === 0.5)).toBe(true)
  expect(hyper.some((h) => h.CELL_SIZE_FACTOR === 2)).toBe(true)
  expect(hyper.some((h) => h.FLIP_TRACE_ALIGNMENT_DIRECTION)).toBe(true)
  expect(hyper.some((h) => h.PRIORITY_DAG_FAMILY_SIZE === 20)).toBe(true)
  const child = grown.generateSolver(hyper[0]!)
  expect(child).toBeInstanceOf(IntraNodeRouteSolver)
  expect(child.physicalContext!.routedPeerWorldIndex).toBe(ledger)
  expect(child.routingBounds).toEqual(grown.constructorParams.routingBounds)
  expect(child.physicalContext!.coordinateScale).toBe(1)
  expect(child.nodeWithPortPoints.portPoints).toBe(node.portPoints)
  ;(grown as unknown as { expandAdaptiveSearch(): void }).expandAdaptiveSearch()
  expect(grown.supervisedSolvers).toBeUndefined()
  expect(grown.adaptiveSearchExpanded).toBe(true)

  const legacy = new GrowShrinkHighDensityIntraNodeSolver({ nodeWithPortPoints: node })
  legacy.scaleFactor = 8
  const affine = create(legacy)
  expect(affine.constructorParams.nativeGridOnly).toBeUndefined()
  expect(affine.getCombinationDefs().some((g) => g.includes("highDensityA01"))).toBe(true)
  expect(affine.constructorParams.nodeWithPortPoints.width).toBe(8)
  expect(affine.constructorParams.priorityCoordinateScale).toBe(8)
  expect(JSON.stringify(node)).toBe(before)
})

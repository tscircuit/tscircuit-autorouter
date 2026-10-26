import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

test("MultiHead copper forces follow physical ownership while distinct via forces remain", () => {
  const third: PolyLine2 = {
    connectionName: "foreign",
    start: { x: -1, y: 1, z1: 2, z2: 2 },
    end: { x: 1, y: 1, z1: 2, z2: 2 },
    mPoints: [{ x: 0, y: 1, z1: 2, z2: 2 }],
  }
  const wire: PolyLine2 = {
    connectionName: "branch-b",
    start: { x: -1, y: 0, z1: 0, z2: 0 },
    end: { x: 1, y: 0, z1: 0, z2: 0 },
    mPoints: [{ x: 0.1, y: 0, z1: 0, z2: 0 }],
  }
  const crossing: PolyLine2 = {
    connectionName: "branch-a",
    start: { x: 0, y: -1, z1: 0, z2: 0 },
    end: { x: 0, y: 1, z1: 0, z2: 0 },
    mPoints: [{ x: 0, y: 0.2, z1: 0, z2: 0 }],
  }
  const via: PolyLine2 = {
    connectionName: "branch-a",
    start: { x: -1, y: 0.08, z1: 0, z2: 0 },
    end: { x: 1, y: 0.08, z1: 1, z2: 1 },
    mPoints: [{ x: 0, y: 0.08, z1: 0, z2: 1 }],
  }
  const makeParams = (
    lines: PolyLine2[],
    ownership: "root" | "connectivity" | "foreign",
  ): ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver2>[0] => {
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "same-owner-force-control",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0, 1, 2],
      portPoints: lines.flatMap((line) => [line.start, line.end].map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z1,
        connectionName: line.connectionName,
        rootConnectionName: ownership === "root" && line.connectionName !== "foreign"
          ? "shared-root"
          : line.connectionName,
      }))),
    }
    return {
      nodeWithPortPoints: node,
      connMap: ownership === "connectivity"
        ? new ConnectivityMap({ own: ["branch-a", "branch-b"], other: ["foreign"] })
        : undefined,
    }
  }

  for (const lines of [
    [crossing, wire, third],
    [via, wire, third],
    [wire, via, third],
  ]) {
    for (const ownership of ["root", "connectivity"] as const) {
      const solver = new MultiHeadPolyLineIntraNodeSolver2(makeParams(lines, ownership))
      const actual = structuredClone(lines)
      expect(solver.applyForcesToPolyLines(actual)).toEqual({
        lastStepMoved: false,
        magForceApplied: 0,
      })
      expect(actual).toEqual(lines)
    }
    const params = makeParams(lines, "foreign")
    const foreign = new MultiHeadPolyLineIntraNodeSolver2(params)
    const reference = new Frozen142EndpointForceSolver(params)
    const actual = structuredClone(lines)
    const expected = structuredClone(lines)
    const result = foreign.applyForcesToPolyLines(actual)
    expect(result).toEqual(reference.applyForcesToPolyLines(expected))
    expect(actual).toEqual(expected)
    expect(result.magForceApplied).toBeGreaterThan(0)

    const activeThird: PolyLine2 = {
      ...third,
      start: { x: -1, y: 0.5, z1: 0, z2: 0 },
      end: { x: 1, y: 0.5, z1: 0, z2: 0 },
      mPoints: [{ x: 0.15, y: 0.5, z1: 0, z2: 0 }],
    }
    const mixed = [lines[0]!, lines[1]!, activeThird]
    const mixedParams = makeParams(mixed, "root")
    const mixedSolver = new MultiHeadPolyLineIntraNodeSolver2(mixedParams)
    const moved = structuredClone(mixed)
    const expectedPositions = mixed.map((line) => structuredClone(line.mPoints))
    for (const index of [0, 1]) {
      const pair = [mixed[index]!, activeThird]
      const movedPair = structuredClone(pair)
      new Frozen142EndpointForceSolver(mixedParams).applyForcesToPolyLines(movedPair)
      for (const [pairIndex, lineIndex] of [[0, index], [1, 2]]) {
        for (let point = 0; point < movedPair[pairIndex]!.mPoints.length; point++) {
          expectedPositions[lineIndex]![point]!.x +=
            movedPair[pairIndex]!.mPoints[point]!.x - pair[pairIndex]!.mPoints[point]!.x
          expectedPositions[lineIndex]![point]!.y +=
            movedPair[pairIndex]!.mPoints[point]!.y - pair[pairIndex]!.mPoints[point]!.y
        }
      }
    }
    expect(mixedSolver.applyForcesToPolyLines(moved).magForceApplied).toBeGreaterThan(0)
    for (let line = 0; line < moved.length; line++) {
      expect(moved[line]!.mPoints[0]!.x).toBeCloseTo(expectedPositions[line]![0]!.x, 14)
      expect(moved[line]!.mPoints[0]!.y).toBeCloseTo(expectedPositions[line]![0]!.y, 14)
    }
  }

  const viaPair: PolyLine2[] = [0, 0.2].map((x, index) => ({
    connectionName: index === 0 ? "branch-a" : "branch-b",
    start: { x, y: 0, z1: 0, z2: 0 },
    end: { x, y: 0, z1: 1, z2: 1 },
    mPoints: [{ x, y: 0, z1: 0, z2: 1 }],
  }))
  viaPair.push(third)
  const solver = new MultiHeadPolyLineIntraNodeSolver2(makeParams(viaPair, "root"))
  const actual = structuredClone(viaPair)
  const force = 0.16 * Math.exp(-6 * 0.2)
  const result = solver.applyForcesToPolyLines(actual)
  expect(result.lastStepMoved).toBe(true)
  expect(result.magForceApplied).toBeCloseTo(2 * force, 14)
  expect(actual[0]!.mPoints[0]!.x).toBeCloseTo(-force, 14)
  expect(actual[1]!.mPoints[0]!.x).toBeCloseTo(0.2 + force, 14)
})

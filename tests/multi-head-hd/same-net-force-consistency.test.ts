import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

function createNode(polyLines: PolyLine2[]): NodeWithPortPoints {
  return {
    capacityMeshNodeId: "parallel-copper",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: polyLines.flatMap((line) => [
      { connectionName: line.connectionName, x: line.start.x, y: line.start.y, z: line.start.z1 },
      { connectionName: line.connectionName, x: line.end.x, y: line.end.y, z: line.end.z2 },
    ]),
  }
}

function advanceForces(
  solver: MultiHeadPolyLineIntraNodeSolver,
  polyLines: PolyLine2[],
): { lastStepMoved: boolean; magForceApplied: number } {
  if (solver instanceof MultiHeadPolyLineIntraNodeSolver2) {
    return solver.applyForcesToPolyLines(polyLines)
  }
  const neighbors = solver.getNeighbors({
    polyLines, g: 0, h: 0, f: 0,
    minGaps: solver.computeMinGapBtwPolyLines(polyLines),
    viaCount: polyLines.reduce((n, line) => n + line.mPoints.filter((point) => point.z1 !== point.z2).length, 0),
  })
  const neighbor = neighbors[0]
  if (!neighbor) return { lastStepMoved: false, magForceApplied: 0 }
  polyLines.splice(0, polyLines.length, ...neighbor.polyLines)
  const magnitude = (neighbor.forces ?? []).flat().reduce(
    (sum, forces) => sum + [...forces.values()].reduce((n, force) => n + Math.hypot(force.fx, force.fy), 0), 0,
  )
  return { lastStepMoved: true, magForceApplied: magnitude }
}

test("polyline forces share the collision check's connectivity policy while different nets still repel", (): void => {
  const connected = new ConnectivityMap({ ground: ["route-a", "alias-a"] })
  connected.addConnections([["alias-a", "route-b"]])
  const separate = new ConnectivityMap({
    ground: ["route-a", "alias-a"],
    signal: ["route-b"],
  })
  const input: PolyLine2[] = [
    {
      connectionName: "route-a",
      start: { x: -1, y: -0.05, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: -0.05, z1: 0, z2: 0 }],
      end: { x: 1, y: -0.05, z1: 0, z2: 0 },
    },
    {
      connectionName: "route-b",
      start: { x: -1, y: 0.05, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0.05, z1: 0, z2: 0 }],
      end: { x: 1, y: 0.05, z1: 0, z2: 0 },
    },
  ]
  const nodeWithPortPoints = createNode(input)

  for (const Solver of [MultiHeadPolyLineIntraNodeSolver, MultiHeadPolyLineIntraNodeSolver2]) {
    const sameNetSolver = new Solver({ nodeWithPortPoints, connMap: connected })
    const sameNetLines = structuredClone(input)
    expect(sameNetSolver.checkIfSolved({
      polyLines: sameNetLines,
      minGaps: sameNetSolver.computeMinGapBtwPolyLines(sameNetLines),
    })).toBe(true)
    const sameNetForces = advanceForces(sameNetSolver, sameNetLines)
    expect(sameNetForces.lastStepMoved).toBe(false)
    expect(sameNetForces.magForceApplied).toBe(0)
    expect(sameNetLines).toEqual(input)

    for (const connMap of [separate, undefined]) {
      const differentNetSolver = new Solver({ nodeWithPortPoints, connMap })
      const differentNetLines = structuredClone(input)
      expect(differentNetSolver.checkIfSolved({
        polyLines: differentNetLines,
        minGaps: differentNetSolver.computeMinGapBtwPolyLines(differentNetLines),
      })).toBe(false)
      const differentNetForces = advanceForces(differentNetSolver, differentNetLines)
      expect(differentNetForces.lastStepMoved).toBe(true)
      expect(differentNetForces.magForceApplied).toBeGreaterThan(0)
      expect(differentNetLines[0]!.mPoints[0]!.y).toBeLessThan(input[0]!.mPoints[0]!.y)
      expect(differentNetLines[1]!.mPoints[0]!.y).toBeGreaterThan(input[1]!.mPoints[0]!.y)
    }
    // Connected copper may meet, but distinct drill centers must still separate.
    const viaLines = structuredClone(input)
    for (const line of viaLines) {
      line.mPoints[0]!.z2 = 1
      line.end.z1 = 1
      line.end.z2 = 1
    }
    const viaSolver = new Solver({ nodeWithPortPoints: createNode(viaLines), connMap: connected })
    const viaForces = advanceForces(viaSolver, viaLines)
    expect(viaForces.lastStepMoved).toBe(true)
    expect(viaForces.magForceApplied).toBeGreaterThan(0)
    expect(viaLines[0]!.mPoints[0]!.y).toBeLessThan(input[0]!.mPoints[0]!.y)
    expect(viaLines[1]!.mPoints[0]!.y).toBeGreaterThan(input[1]!.mPoints[0]!.y)

    // Both via/segment directions allow connected copper to meet.
    for (const viaLineIndex of [0, 1]) {
      const contactLines = structuredClone(input)
      contactLines[viaLineIndex]!.mPoints[0]!.z2 = 1
      contactLines[viaLineIndex]!.end.z1 = 1
      contactLines[viaLineIndex]!.end.z2 = 1
      const originalContact = structuredClone(contactLines)
      const contactSolver = new Solver({ nodeWithPortPoints: createNode(contactLines), connMap: connected })
      const contactForces = advanceForces(contactSolver, contactLines)
      expect(contactForces.lastStepMoved).toBe(false)
      expect(contactForces.magForceApplied).toBe(0)
      expect(contactLines).toEqual(originalContact)

      const differentNetContactSolver = new Solver({ nodeWithPortPoints: createNode(contactLines), connMap: separate })
      const differentNetContactForces = advanceForces(differentNetContactSolver, contactLines)
      expect(differentNetContactForces.lastStepMoved).toBe(true)
      expect(differentNetContactForces.magForceApplied).toBeGreaterThan(0)
    }
  }
})

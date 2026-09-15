import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { SolverProfiler } from "lib/solvers/SolverProfiler"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class A11Portfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [["highDensityA11"]]
  }
}

test("profiling retains A11 work, progress, selection and rejected copper", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "profile-node",
    center: { x: 0, y: 0 },
    width: 12,
    height: 2,
    availableZ: [0],
    portPoints: [
      { connectionName: "signal", x: -6, y: 0, z: 0 },
      { connectionName: "signal", x: 6, y: 0, z: 0 },
    ],
  }
  const profiler = new SolverProfiler(new Set(["HighDensitySolverA11"]))
  SolverProfiler.active = profiler
  try {
    const portfolio = new A11Portfolio({
      nodeWithPortPoints,
      traceWidth: 0.1,
      viaDiameter: 0.3,
      enableNegotiatedSearch: true,
    })
    portfolio.step()
    const unfinished = profiler.records.find((record) => record.name === "HighDensitySolverA11")
    expect(unfinished?.outcome).toBe("running")
    expect(unfinished?.iterations).toBe(100)
    expect(unfinished?.timeMs).toBeGreaterThan(0)
    expect(unfinished?.nodeId).toBe(nodeWithPortPoints.capacityMeshNodeId)
    expect(unfinished?.solverParameters).toMatchObject({
      traceThickness: 0.1,
      traceMargin: 0.1,
      viaDiameter: 0.3,
      viaMinDistFromBorder: 0.15,
      cellSizeMm: 0.05,
      hyperParameters: { shuffleSeed: 0 },
    })
    portfolio.solve()
    expect(unfinished?.outcome).toBe("solved")
    expect(unfinished?.selected).toBe(true)
    expect(unfinished?.solvedSegmentCount).toBe(1)
    expect(unfinished?.pendingSegmentCount).toBe(0)
    expect(unfinished?.progress).toBe(1)
    expect(profiler.records.filter((record) => record.name === "HighDensitySolverA11")).toHaveLength(1)

    const blocked = new A11Portfolio({
      nodeWithPortPoints,
      traceWidth: 0.1,
      viaDiameter: 0.3,
      layerCount: 2,
      enableNegotiatedSearch: true,
      obstacles: [{
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["other-net"],
      }],
    })
    blocked.solve()
    const rejected = profiler.records.find((record) => record.name === "HighDensitySolverA11" && record.outcome === "rejected")
    expect(rejected?.success).toBe(false)
    expect(rejected?.selected).toBe(false)
    expect(rejected?.rejectionReason).toContain("board copper validation")
  } finally {
    SolverProfiler.active = null
  }
})

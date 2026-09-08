import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("custom scheduling accessors and public step hooks retain the original loop", () => {
  for (const scenario of [
    "limit-accessor",
    "limit-coercion",
    "limit-bigint",
    "limit-mutation",
    "solver-accessor",
    "solver-replacement",
    "batch-accessor",
  ]) {
    const records = [false, true].map((optimized) => {
      const nodeWithPortPoints = {
        capacityMeshNodeId: "custom-native-batch",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [],
      }
      const supervisor = new PortfolioSingleIntraNodeSolver({
        nodeWithPortPoints,
        obstacles: [],
        layerCount: 2,
      })
      supervisor.MIN_SUBSTEPS = 5
      const solver = new HighDensitySolverA01({
        nodeWithPortPoints,
        useNativeSearch: true,
        cellSizeMm: 0.1,
        traceMargin: 0.15,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
      })
      const supervised = { solver, hyperParameters: {}, g: 0, h: 0, f: 0 }
      const events: string[] = []
      let reads = 0
      const replacement = {
        step(): void {
          events.push("replacement")
        },
      }
      solver.step = (): void => {
        events.push("step")
        if (scenario === "limit-mutation") supervisor.MIN_SUBSTEPS = 1
        if (scenario === "solver-replacement")
          supervised.solver = replacement as any
      }
      if (scenario === "limit-accessor")
        Object.defineProperty(supervisor, "MIN_SUBSTEPS", {
          get() {
            events.push("limit")
            return ++reads === 1 ? 5 : 1
          },
        })
      if (scenario === "limit-coercion")
        (supervisor as any).MIN_SUBSTEPS = {
          valueOf() {
            events.push("coerce")
            return ++reads === 1 ? 5 : 1
          },
        }
      if (scenario === "limit-bigint") (supervisor as any).MIN_SUBSTEPS = 2n
      if (scenario === "solver-accessor")
        Object.defineProperty(supervised, "solver", {
          get() {
            events.push("solver")
            return ++reads === 1 ? solver : replacement
          },
        })
      if (scenario === "batch-accessor")
        Object.defineProperty(solver, "stepNativeBatch", {
          get() {
            throw new Error(
              "The original loop does not read a custom batch accessor",
            )
          },
        })
      const prototype = optimized
        ? PortfolioSingleIntraNodeSolver.prototype
        : HyperParameterSupervisorSolver.prototype
      ;(prototype as any).stepSupervisedSolver.call(supervisor, supervised)
      return events
    })
    expect(records[1]).toEqual(records[0])
  }
})

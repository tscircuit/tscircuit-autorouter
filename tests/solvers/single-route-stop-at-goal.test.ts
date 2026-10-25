import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  afterColor,
  beforeColor,
  expectPerformanceSvg,
  performanceCanvas,
  projectVisual,
  visualMetric,
  visualPanel,
  visualText,
} from "../fixtures/performanceVisual"
import { stepWithOriginalGoalExpansion } from "../fixtures/stepWithOriginalGoalExpansion"

test("route search stops expanding after accepting its checked goal connection", async (): Promise<void> => {
  const snapshots: Array<{
    solver: string
    iterations: number
    neighborExpansions: number
    expansionsAfterSuccess: number
    route: NonNullable<SingleHighDensityRouteSolver["solvedPath"]>
  }> = []
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const props = {
      connectionName: "signal",
      minDistBetweenEnteringPoints: 0.2,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      A: { x: 1, y: 1, z: 0 },
      B: { x: 3, y: 1, z: 0 },
      obstacleRoutes: [],
      futureConnections: [
        {
          connectionName: "other",
          points: [
            { x: 1, y: 3, z: 0 },
            { x: 3, y: 3, z: 0 },
          ],
        },
      ],
    }
    const solver = new Solver(props)
    const original = new Solver(structuredClone(props))
    original._step = stepWithOriginalGoalExpansion.bind(original)
    const originalGetNeighbors = original.getNeighbors.bind(original)
    const discarded: {
      node?: Node
      neighbors: Node[]
      expansions: number
    } = { neighbors: [], expansions: 0 }
    original.getNeighbors = (node: Node): Node[] => {
      const neighbors = originalGetNeighbors(node)
      if (original.solved) {
        discarded.node = node
        discarded.neighbors = neighbors
        discarded.expansions++
      }
      return neighbors
    }
    const getNeighbors = solver.getNeighbors.bind(solver)
    let expansions = 0
    let expansionsAfterSuccess = 0
    solver.getNeighbors = (node: Node): Node[] => {
      if (solver.solved) expansionsAfterSuccess++
      expect(solver.solved).toBeFalse()
      expansions++
      return getNeighbors(node)
    }
    solver.solve()
    original.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(expansions).toBeGreaterThan(0)
    expect(expansions).toBe(solver.iterations - 1)
    expect(solver.solvedPath!.route[0]).toEqual(solver.A)
    expect(solver.solvedPath!.route.at(-1)).toEqual(solver.B)
    expect(solver.solvedPath!.vias).toEqual([])
    expect(solver.solvedPath).toEqual(original.solvedPath)
    expect(solver.iterations).toBe(original.iterations)
    expect(discarded.expansions).toBe(1)
    expect(discarded.neighbors.length).toBeGreaterThan(0)
    snapshots.push({
      solver: Solver.name,
      iterations: solver.iterations,
      neighborExpansions: expansions,
      expansionsAfterSuccess,
      route: solver.solvedPath!,
    })
    if (Solver === SingleHighDensityRouteSolver) {
      if (!discarded.node)
        throw new Error(
          "Expected the original solver to expand its accepted goal",
        )
      const graphics = performanceCanvas(
        "Stop expanding once the checked goal connection is accepted",
        "The baseline really runs its original step implementation. Orange branches are unused neighbors created after success.",
      )
      for (const [left, title, color] of [
        [24, "Before: success still generates neighbors", beforeColor],
        [624, "After: return immediately after success", afterColor],
      ] as const) {
        visualPanel(
          graphics,
          left,
          title,
          left === 24
            ? `${discarded.neighbors.length} extra neighbor objects; none improve the accepted route.`
            : "Zero extra neighbor objects. The complete accepted route is identical.",
          color,
        )
        const project = projectVisual(
          { minX: 0.7, maxX: 3.5, minY: 0.3, maxY: 1.8 },
          left + 35,
          205,
          482,
          260,
        )
        graphics.lines.push({
          points: solver.solvedPath!.route.map(project),
          strokeColor: "#2563eb",
          strokeWidth: 3,
        })
        for (const [label, point] of [
          ["A", solver.A],
          ["B: accepted goal", solver.B],
        ] as const) {
          const screen = project(point)
          graphics.circles.push({
            center: screen,
            radius: 6,
            fill: label === "A" ? "#2563eb" : afterColor,
            stroke: "white",
          })
          visualText(
            graphics,
            screen.x - 16,
            screen.y + (label === "A" ? 34 : 80),
            label,
            14,
            label === "A" ? "#2563eb" : afterColor,
          )
        }
        const origin = project(discarded.node)
        graphics.circles.push({
          center: origin,
          radius: 5,
          fill: "white",
          stroke: "#475569",
        })
        if (left === 24) {
          for (const neighbor of discarded.neighbors) {
            const screen = project(neighbor)
            if (neighbor.z !== discarded.node.z) {
              screen.x += 18
              screen.y -= 64
            }
            graphics.arrows.push({
              start: origin,
              end: screen,
              color: beforeColor,
            })
            graphics.circles.push({
              center: screen,
              radius: 4,
              fill: "#ffedd5",
              stroke: beforeColor,
            })
            if (neighbor.z !== discarded.node.z)
              visualText(
                graphics,
                screen.x + 9,
                screen.y - 8,
                `via z${neighbor.z}`,
                12,
                beforeColor,
              )
          }
        }
        visualText(
          graphics,
          left + 20,
          490,
          "Blue: accepted path centerline. Orange: post-success neighbors.",
          13,
          "#64748b",
        )
        visualText(
          graphics,
          left + 20,
          185,
          "The via node is offset to distinguish its separate layer.",
          12,
          "#64748b",
        )
      }
      visualMetric(
        graphics,
        "Neighbor objects generated after accepting the goal",
        discarded.neighbors.length,
        expansionsAfterSuccess,
        `The complete route and ${solver.iterations} iterations match the baseline; both base and future-cost variants are checked.`,
      )
      await expectPerformanceSvg(graphics, import.meta.path)
    }
  }
  expect(snapshots).toMatchSnapshot(
    "accepted goals keep the complete route and produce no further neighbors",
  )
})

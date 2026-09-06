import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  CLEARANCE_SLACK,
  TRACE_PAD_REPAIR_MAX_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 compensates a free endpoint's contact weight using the official pad requirement", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0, traceThickness: 0.1 },
      { x: 4, y: 2, z: 0 },
    ],
    vias: [],
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "B-component",
    pcb_port_id: "B-port",
    shape: "rect" as const,
    x: 0.4,
    y: -0.12,
    width: 0.02,
    height: 0.02,
    layer: "top" as const,
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: pad.width,
      height: pad.height,
      layers: [pad.layer],
      connectedTo: [pad.pcb_smtpad_id],
    },
  ]
  const connMap = new ConnectivityMap({ A: ["A_0"], B: ["foreign-pad"] })
  const getErrors = (
    candidate: HighDensityRoute,
    minimumClearance: number,
  ): ReturnType<typeof checkPadTraceClearance> => {
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      source_trace_id: "A",
      route: candidate.route.map((point): PcbTrace["route"][number] => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: point.traceThickness ?? candidate.traceThickness,
        layer: "top",
      })),
    }
    return checkPadTraceClearance([trace, pad], {
      connMap,
      minClearance: minimumClearance,
    })
  }
  const original = structuredClone({ route, pad, obstacles })
  const displacements: number[] = []
  for (const minimumClearance of [0.08, 0.1]) {
    const initialErrors = getErrors(route, minimumClearance)
    expect(initialErrors).toHaveLength(1)
    const requirement = initialErrors[0]!.minimum_clearance
    expect(requirement).toBe(minimumClearance)
    const target = getPipeline9PadCopperForceTarget({
      pad,
      route,
      obstacles,
      layerCount: 2,
    })!
    expect(target.segmentIndex).toBe(0)
    const mobility = getPipeline9PadTraceForceMobility({
      route,
      target,
      protectedPointIndexes: new Set(),
    })
    expect(mobility.pointIndexes).toEqual([1])
    expect(mobility.contactWeight).toBeCloseTo(target.tracePoint.x / 2, 12)
    expect(mobility.contactWeight).toBeLessThan(1)
    const desiredContactMove =
      route.traceThickness / 2 +
      requirement +
      2 * CLEARANCE_SLACK -
      target.distance
    const oldMove = Math.min(TRACE_PAD_REPAIR_MAX_MOVE, desiredContactMove)
    // Reproduce the previous unweighted endpoint translation. It improves the
    // real gap but leaves this same official error unresolved.
    const undercorrected = structuredClone(route)
    undercorrected.route[1]!.y += oldMove
    const oldErrors = getErrors(undercorrected, requirement)
    expect(oldErrors).toHaveLength(1)
    expect(oldErrors[0]!.actual_clearance).toBeGreaterThan(
      initialErrors[0]!.actual_clearance,
    )
    const repaired = structuredClone(route)
    expect(
      applyPipeline9PadTraceForce({
        route: repaired,
        target,
        protectedPointIndexes: new Set(),
        minimumClearance: requirement,
        scale: 1,
      }),
    ).toBe(true)
    expect(getErrors(repaired, requirement)).toHaveLength(0)
    expect(repaired.route[1]!.y).toBeCloseTo(
      Math.min(
        TRACE_PAD_REPAIR_MAX_MOVE,
        desiredContactMove / mobility.contactWeight,
      ),
      12,
    )
    expect(repaired.route[0]).toEqual(route.route[0])
    expect(repaired.route.at(-1)).toEqual(route.route.at(-1))
    expect(repaired.vias).toEqual(route.vias)
    expect(repaired).toEqual({ ...route, route: repaired.route })
    displacements.push(repaired.route[1]!.y)

    const reversed = structuredClone(route)
    reversed.route.reverse()
    const reversedTarget = getPipeline9PadCopperForceTarget({
      pad,
      route: reversed,
      obstacles,
      layerCount: 2,
    })!
    expect(
      applyPipeline9PadTraceForce({
        route: reversed,
        target: reversedTarget,
        protectedPointIndexes: new Set(),
        minimumClearance: requirement,
        scale: 1,
      }),
    ).toBe(true)
    expect(getErrors(reversed, requirement)).toHaveLength(0)
    expect(reversed.route[1]!.y).toBeCloseTo(repaired.route[1]!.y, 12)

    const rigid = structuredClone(route)
    rigid.route.unshift({ x: -2, y: 2, z: 0 })
    const rigidTarget = getPipeline9PadCopperForceTarget({
      pad,
      route: rigid,
      obstacles,
      layerCount: 2,
    })!
    expect(rigidTarget.segmentIndex).toBe(1)
    expect(
      getPipeline9PadTraceForceMobility({
        route: rigid,
        target: rigidTarget,
        protectedPointIndexes: new Set(),
      }),
    ).toEqual({ pointIndexes: [1, 2], contactWeight: 1 })
    expect(
      applyPipeline9PadTraceForce({
        route: rigid,
        target: rigidTarget,
        protectedPointIndexes: new Set(),
        minimumClearance: requirement,
        scale: 1,
      }),
    ).toBe(true)
    expect(rigid.route[1]!.y).toBeCloseTo(oldMove, 12)
    expect(rigid.route[2]!.y).toBeCloseTo(oldMove, 12)
  }
  expect(displacements[1]!).toBeGreaterThan(displacements[0]!)
  const target = getPipeline9PadCopperForceTarget({
    pad,
    route,
    obstacles,
    layerCount: 2,
  })!
  for (const invalid of [undefined, Number.NaN, Infinity, -0.1]) {
    expect(() =>
      applyPipeline9PadTraceForce({
        route,
        target,
        protectedPointIndexes: new Set(),
        // Deliberately violate the required runtime data contract.
        minimumClearance: invalid as number,
        scale: 1,
      }),
    ).toThrow("Pipeline9 pad-wire force requires an official clearance")
  }
  expect({ route, pad, obstacles }).toEqual(original)
})

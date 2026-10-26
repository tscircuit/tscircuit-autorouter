import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import fixture from "../fixtures/sample24-closed-form-foreign-bottom-via.json"

test("via acceptance preserves own copper, blind spans, clearance and actual grow/shrink coordinates", (): void => {
  const params = {
    nodeWithPortPoints: structuredClone(fixture.node),
    obstacles: [structuredClone(fixture.obstacle)],
    layerCount: 8,
    allowBlindAndBuriedVias: false,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    obstacleMargin: 0.15,
    viaToPadClearance: 0.1,
  }
  const publish = (owner: PortfolioSingleIntraNodeSolver): boolean => {
    const candidate = owner.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
    owner.supervisedSolvers = [{ solver: candidate, hyperParameters: {}, f: 0, g: 0, h: 0 }]
    owner.step()
    return owner.solved
  }
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, allowBlindAndBuriedVias: true }))).toBe(true)
  const ownPad = { ...params.obstacles[0]!, connectedTo: [fixture.node.portPoints[0]!.rootConnectionName] }
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [ownPad] }))).toBe(true)
  const connMap = new ConnectivityMap({ signal: ["source_net_altium_pcb_181", "pad-alias"] })
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, connMap, obstacles: [{ ...ownPad, connectedTo: ["pad-alias"] }] }))).toBe(true)
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [] }))).toBe(true)
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [{ ...ownPad, connectedTo: [] }] }))).toBe(false)
  const marked = new PortfolioSingleIntraNodeSolver(params)
  const markedCandidate = marked.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  markedCandidate.solvedRoutes[0]!.route[1]!.toNextSegmentType = "through_obstacle"
  marked.supervisedSolvers = [{ solver: markedCandidate, hyperParameters: {}, f: 0, g: 0, h: 0 }]
  marked.step()
  // An explicit drilled via remains full-stack even beside this copper marker.
  expect(marked.solved).toBe(false)

  // The candidate center is exactly radius(.15)+the supplied gap(.1) from
  // this pad. The unrelated .15 trace-obstacle margin must not replace it.
  const edgePad = { ...ownPad, connectedTo: ["foreign"], width: 0.2, height: 0.2,
    center: { x: fixture.capturedVia.x + 0.35, y: fixture.capturedVia.y }, layers: ["bottom"] }
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [edgePad] }))).toBe(true)
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [{ ...edgePad, center: { ...edgePad.center, x: edgePad.center.x - 1e-5 } }] }))).toBe(false)
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [{ ...edgePad, shape: "circle" as const, center: { ...edgePad.center, x: edgePad.center.x - 1e-5 } }] }))).toBe(false)
  expect(publish(new PortfolioSingleIntraNodeSolver({ ...params, obstacles: [{ ...edgePad, width: 0.1, height: 0.6, ccwRotationDegrees: 90, center: { x: fixture.capturedVia.x + 0.3, y: fixture.capturedVia.y } }] }))).toBe(false)

  // Use the actual GrowShrink constructor path to establish the non-origin
  // scaled frame. Backend XY is outside C74, but its emitted world via is in it.
  const grow = new GrowShrinkHighDensityIntraNodeSolver(params)
  grow.scaleFactor = 8
  ;(grow as any).createActiveSubSolver()
  const scaled = grow.activeSubSolver!
  expect(scaled.constructorParams.priorityCoordinateScale).toBe(8)
  expect(scaled.nodeWithPortPoints.center).toEqual(fixture.node.center)
  const scaledCandidate = scaled.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  expect(scaledCandidate.solvedRoutes[0]!.vias[0]!.x).toBeGreaterThan(fixture.obstacle.center.x + fixture.obstacle.width / 2)
  scaled.supervisedSolvers = [{ solver: scaledCandidate, hyperParameters: {}, f: 0, g: 0, h: 0 }]
  scaled.step()
  expect(scaled.solved).toBe(false)
  expect(scaledCandidate.failed).toBe(true)
  expect(scaledCandidate.solvedRoutes[0]!.viaDiameter).toBe(0.3)

  // Obtain board XY through GrowShrink's actual accepted-output conversion.
  // At a pad edge the unscaled physical .3 diameter must also be preserved.
  const clearGrow = new GrowShrinkHighDensityIntraNodeSolver({ ...params, obstacles: [] })
  clearGrow.scaleFactor = 8
  ;(clearGrow as any).createActiveSubSolver()
  expect(publish(clearGrow.activeSubSolver!)).toBe(true)
  ;(clearGrow as any).acceptSolution(clearGrow.activeSubSolver!)
  const worldVia = clearGrow.solvedRoutes[0]!.vias[0]!
  const scaleEdgePad = { ...edgePad, center: { x: worldVia.x + 0.3, y: worldVia.y } }
  const edgeGrow = new GrowShrinkHighDensityIntraNodeSolver({ ...params, obstacles: [scaleEdgePad] })
  edgeGrow.scaleFactor = 8
  ;(edgeGrow as any).createActiveSubSolver()
  expect(publish(edgeGrow.activeSubSolver!)).toBe(false)
  expect(clearGrow.solvedRoutes[0]!.viaDiameter).toBe(0.3)

  const regular = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [fixture.node], colorMap: {}, connMap, fixedHdRoutes: [], effort: 1 })
  regular.step()
  regular.activeRegularSolver!.step()
  const regularGrow = regular.activeRegularSolver!.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  expect(regularGrow.constructorParams.viaToPadClearance).toBe(0.1)
  expect(regularGrow.constructorParams.allowBlindAndBuriedVias).toBe(false)
  const regional = new Pipeline9RegionalFallbackSolver({ ...params, connMap, colorMap: {}, effort: 1 })
  regional.highDensitySolver.step()
  const regionalGrow = regional.highDensitySolver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  expect(regionalGrow.constructorParams.viaToPadClearance).toBe(0.1)
  expect(regionalGrow.constructorParams.allowBlindAndBuriedVias).toBe(false)
})

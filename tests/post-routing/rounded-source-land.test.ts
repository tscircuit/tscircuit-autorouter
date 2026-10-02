import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { restorePostRoutingPadMetadata } from "lib/utils/restorePostRoutingPadMetadata"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { copperGap, segmentCopperGap } from "lib/solvers/DynamicNetTreeSolver/dynamicNetTreeGeometry"
import { boardFixture } from "./fixtures"

test("source restoration distinguishes exact rounded copper, legacy PCB-port metadata, and independent circular drills", () => {
  const input = boardFixture()
  const pad = input.srj.obstacles[0]!
  pad.connectedTo = ["land", "a", "land", "source-port", "pcb-port"]
  pad.circuitJsonMetadata = {pcb_smtpad_id: "land", pcb_port_id: "source-port"}
  const source = [{type: "pcb_smtpad", pcb_smtpad_id: "land", pcb_port_id: "pcb-port",
    x: pad.center.x, y: pad.center.y, width: pad.width, height: pad.height,
    shape: "rotated_rect", ccw_rotation: 15, corner_radius: .1, layer: "top"}] as AnyCircuitElement[]
  const original = structuredClone(input)
  const physical = restorePostRoutingPadMetadata(input.srj, source)
  expect(physical.obstacles[0]!.circuitJsonMetadata!.pcb_port_id).toBe("pcb-port")
  expect(physical.obstacles[0]!.cornerRadius).toBe(.1)
  expect(physical.obstacles[0]!.connectedTo).toEqual(pad.connectedTo)
  expect(input).toEqual(original)
  const copper = createDynamicNetTreeProblem(physical,"signal",[],input.traceOwners).copper[0]!
  expect(copper.radius).toBe(.1)
  expect(copper.rectangle!.width).toBeCloseTo(.6)
  expect(copper.rectangle!.height).toBeCloseTo(.4)
  const contained = {...copper, id: "contained", radius: 0, rectangle: {width: .1,height: .1,rotation: 0}}
  expect(copperGap(copper,contained)).toBeLessThanOrEqual(0)
  expect(copperGap(contained,copper)).toBeLessThanOrEqual(0)
  const oval = structuredClone(physical.obstacles[0]!)
  oval.landShape = "oval"; oval.width = 2; oval.height = 1
  oval.layers = ["top","bottom"]; oval.isPlated = true
  oval.holeShape = "circle"; oval.holeDiameter = .3
  physical.obstacles[0] = oval
  const drilled = createDynamicNetTreeProblem(physical,"signal",[],input.traceOwners).copper[0]!
  expect(drilled.start).not.toEqual(oval.center)
  expect(drilled.drill!.start).toEqual(oval.center)
  expect(drilled.drill!.end).toEqual(oval.center)
  expect(segmentCopperGap(oval.center,oval.center,drilled)).toBeLessThan(0)
  const bad = structuredClone(source) as unknown as Record<string,unknown>[]
  bad[0]!.pcb_port_id = "foreign-port"
  expect(()=>restorePostRoutingPadMetadata(input.srj,bad as unknown as AnyCircuitElement[])).toThrow()
  pad.connectedTo.push("foreign-port")
  expect(()=>restorePostRoutingPadMetadata(input.srj,bad as unknown as AnyCircuitElement[])).toThrow()
  const missing = restorePostRoutingPadMetadata(input.srj, [])
  expect(missing.obstacles[0]!.unsupportedPhysicalGeometry).toContain("Referenced source pad absent")
})

import {expect,test} from "bun:test"
import {TopologyMergingSolver} from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import {createOverlayGridTopology} from "../fixtures/createOverlayGridTopology"

test("completed topology releases working regions and preserves output, input and visualization",():void=>{
  const input=createOverlayGridTopology(8),before=JSON.stringify(input),solver=new TopologyMergingSolver(input)
  const work=(solver as unknown as {atomicRegions:unknown[]}).atomicRegions
  solver.step()
  expect(work.length).toBeGreaterThan(0)
  expect(solver.visualize().rects!.length).toBeGreaterThan(0)
  solver.solve()
  expect(solver.solved).toBe(true);expect(solver.failed).toBe(false)
  const output=solver.getOutput(),serialized=JSON.stringify(output)
  expect(output.length).toBeGreaterThan(0)
  expect(solver.visualize().rects!.length).toBe(output.length)
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.getConstructorParams()[0]).toBe(input)
  solver.step()
  expect(solver.getOutput()).toBe(output)
  expect(JSON.stringify(solver.getOutput())).toBe(serialized)
  expect(work.length).toBe(0)
})

import {expect,test} from "bun:test"
import {AvailableSegmentPointSolver} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {consumeSegmentPortPoints} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/consumeSegmentPortPoints"
import {createPortLookupInput} from "../fixtures/createPortLookupInput"

test("consuming construction ports preserves exact order and progressively releases segment references",():void=>{
 const input=createPortLookupInput(4),before=JSON.stringify(input),solver=new AvailableSegmentPointSolver(input)
 solver.solve()
 const segments=solver.getOutput(),expected=segments.flatMap(s=>s.portPoints),iterator=consumeSegmentPortPoints(segments)
 expect(iterator.next().value).toBe(expected[0])
 expect(segments[0]).toBeUndefined()
 expect(segments[1]).toBeDefined()
 const remaining=[...iterator]
 expect(remaining).toEqual(expected.slice(1))
 expect(segments.length).toBe(0)
 expect(JSON.stringify(input)).toBe(before)
})

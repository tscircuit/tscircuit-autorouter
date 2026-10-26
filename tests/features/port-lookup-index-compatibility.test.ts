import {expect,test} from "bun:test"
import {AvailableSegmentPointSolver} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {createPortLookupInput} from "../fixtures/createPortLookupInput"

test("native port lookup retains identity, early map references and assignment semantics", (): void => {
  let baseline:string|undefined
  for(const accessBeforeSolve of [false,true]) {
    const input=createPortLookupInput(4),before=JSON.stringify(input),solver=new AvailableSegmentPointSolver(input)
    const earlyPorts=accessBeforeSolve?solver.portPointMap:undefined,earlyEdges=accessBeforeSolve?solver.edgeSegmentMap:undefined
    if(earlyPorts)expect(earlyPorts.size).toBe(0)
    solver.solve()
    expect(solver.solved).toBe(true);expect(solver.failed).toBe(false)
    const output=solver.getOutput(),serialized=JSON.stringify(output)
    if(baseline===undefined)baseline=serialized
    expect(serialized).toBe(baseline)
    expect(JSON.stringify(input)).toBe(before)
    expect(solver.portPointMap.size).toBe(output.reduce((sum,segment)=>sum+segment.portPoints.length,0))
    expect(solver.nodeEdgeMap.get("left-0")).toEqual([input.edges[0]!])
    if(earlyPorts)expect(solver.portPointMap).toBe(earlyPorts)
    if(earlyEdges)expect(solver.edgeSegmentMap).toBe(earlyEdges)
    for(const segment of output) {
      expect(solver.edgeSegmentMap.get(segment.edgeId)).toBe(segment)
      for(const port of segment.portPoints)expect(solver.portPointMap.get(port.segmentPortPointId)).toBe(port)
    }
    const port=output[0]!.portPoints[0]!,portId=port.segmentPortPointId
    expect(solver.getPortPointsForEdge("left-0","right-0")).toBe(output[0]!.portPoints)
    expect(solver.assignPortPoint(portId,"signal","root")).toBe(true)
    expect(port.connectionName).toBe("signal");expect(port.rootConnectionName).toBe("root")
    expect(solver.assignPortPoint(portId,"other")).toBe(false)
    expect(solver.getAvailablePortPointsBetweenNodes("left-0","right-0")).not.toContain(port)
    expect(solver.releasePortPoint(portId)).toBe(true)
    expect(port.connectionName).toBeNull();expect(port.rootConnectionName).toBeUndefined()
    expect(solver.assignPortPoint("missing","signal")).toBe(false)
    expect(solver.releasePortPoint("missing")).toBe(false)
    expect(JSON.stringify(output)).toBe(serialized)
  }
})

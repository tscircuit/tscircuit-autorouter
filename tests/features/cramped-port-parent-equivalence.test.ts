import {expect,test} from "bun:test"
import {SingleTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import {createSeededCrampedPortGraph} from "../fixtures/createSeededCrampedPortGraph"
import golden from "../fixtures/cramped-port-parent-results.json"

test("cramped-port candidates retain parent ordering, depth, and costs on cyclic graphs", (): void => {
  for(const sample of golden) {
    const input=createSeededCrampedPortGraph(sample.seed,sample.depth,sample.ignoreCramped)
    const before=JSON.stringify([...input.mapOfCapacityMeshNodeIdToSegmentPortPoints])
    const solver=new SingleTargetNecessaryCrampedPortPointSolver(input);solver.solve()
    expect(solver.solved).toBe(true)
    const actual=solver.getOutput().map(candidate=>{
      const chain:string[]=[];let current:typeof candidate|null=candidate
      while(current){chain.push(current.port.segmentPortPointId);current=current.parent}
      return {depth:candidate.depth,cramped:candidate.countOfCrampedPortPointsInPath,chain}
    })
    expect(actual).toEqual(sample.output)
    expect(JSON.stringify([...input.mapOfCapacityMeshNodeIdToSegmentPortPoints])).toBe(before)
  }
})

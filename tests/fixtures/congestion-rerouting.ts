import { TinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"
import type { CapacityMeshNode } from "lib/types"

export function createCongestionFixture(blockDetour = false): { solver: TinyHyperGraphSolver; nodesByRegionId: Map<number, CapacityMeshNode> } {
  // H, L, R, N, S, U. Two crossing nets in H; U is an unused detour.
  const regions = [[0,0,1,1],[-1,0,1,1],[1,0,1,1],[0,1,1,1],[0,-1,1,1],[0,2,3,1]]
  const ports = [[-.5,0],[.5,0],[0,.5],[0,-.5],[-1,0],[1,0],[0,1],[0,-1],[-1,1.5],[1,1.5]]
  const incident = [[0,1],[0,2],[0,3],[0,4],[1],[2],[3],[4],[1,5],[5,2]]
  const topology: TinyHyperGraphTopology = {
    portCount: ports.length, regionCount: regions.length,
    incidentPortRegion: incident,
    regionIncidentPorts: regions.map((_,r) => incident.flatMap((rs,p) => rs.includes(r) ? [p] : [])),
    regionWidth: Float64Array.from(regions.map(r=>r[2])), regionHeight: Float64Array.from(regions.map(r=>r[3])),
    regionCenterX: Float64Array.from(regions.map(r=>r[0])), regionCenterY: Float64Array.from(regions.map(r=>r[1])),
    regionAvailableZMask: new Int32Array(regions.length).fill(1),
    portX: Float64Array.from(ports.map(p=>p[0])), portY: Float64Array.from(ports.map(p=>p[1])),
    portZ: new Int32Array(ports.length), portAngleForRegion1: new Int32Array(ports.length), portAngleForRegion2: new Int32Array(ports.length),
  }
  for (let p=0;p<ports.length;p++) for (let i=0;i<incident[p].length;i++) {
    const r=regions[incident[p][i]]
    const angle=Math.round((Math.atan2(ports[p][1]-r[1],ports[p][0]-r[0])*18000/Math.PI+36000)%36000)
    ;(i===0?topology.portAngleForRegion1:topology.portAngleForRegion2!)[p]=angle
  }
  const problem: TinyHyperGraphProblem = {
    routeCount:2, routeStartPort:Int32Array.from([4,6]),routeEndPort:Int32Array.from([5,7]),routeNet:Int32Array.from([0,1]),
    regionNetId:new Int32Array(regions.length).fill(-1),portSectionMask:new Int8Array(ports.length).fill(1),
    initialAssignments:[
      {routeId:0,regionId:1,fromPortId:4,toPortId:0},{routeId:0,regionId:0,fromPortId:0,toPortId:1},{routeId:0,regionId:2,fromPortId:1,toPortId:5},
      {routeId:1,regionId:3,fromPortId:6,toPortId:2},{routeId:1,regionId:0,fromPortId:2,toPortId:3},{routeId:1,regionId:4,fromPortId:3,toPortId:7},
    ],
  }
  if(blockDetour) { problem.portSectionMask[8]=0; problem.portSectionMask[9]=0 }
  const solver = new TinyHyperGraphSolver(topology,problem,{RIP_THRESHOLD_START:100,RIP_THRESHOLD_END:100,RIP_THRESHOLD_RAMP_ATTEMPTS:0})
  solver.solve()
  const nodesByRegionId = new Map(regions.map((r,id)=>[id,{capacityMeshNodeId:String(id),center:{x:r[0],y:r[1]},width:r[2],height:r[3],availableZ:[0],layer:"top"}]))
  return {solver,nodesByRegionId}
}

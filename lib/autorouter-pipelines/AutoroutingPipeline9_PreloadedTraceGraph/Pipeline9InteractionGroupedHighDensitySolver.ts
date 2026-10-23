import { getFixedObstacleViolations, getNewViaPadViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { Obstacle } from "lib/types"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { getObstacleRouteConnectivity } from "lib/solvers/HyperHighDensitySolver/getObstacleRouteConnectivity"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { getPipeline9LayerTransitionViaEndpoint } from "./getPipeline9LayerTransitionViaEndpoint"
import { getCanonicalPipeline9PortRoot } from "./getCanonicalPipeline9PortRoot"

type NativeParams = ConstructorParameters<typeof HighDensitySolver>[0]
type Params = NativeParams & { allowBlindAndBuriedVias?: boolean }
type Group = { id: number; names: Set<string>; routes?: HighDensityRoute[]; work: number; changed: boolean }
type CounterMap = Record<string, number>
export const interactionCounterNames = [
  "InitialGroups", "GroupPlans", "ChildAllocatedIterations", "ChildIterations", "Audits", "GroupPairChecks", "RoutePairChecks", "CopperPrimitiveTests", "DrillPrimitiveTests", "DrillConflicts", "InteractionEdges", "MergeEvents", "MergedGroups", "ReroutedConnections", "RetainedGroupsAtMerge", "RetainedRoutesAtMerge", "RetainedIterationsAtMerge", "ReservationChecks", "CandidateValidations", "CandidateRejections", "CanonicalTransitionVertices", "ObstacleChecks", "BoardDrcChecks", "UnknownGroupFailures", "OuterAllowanceExhaustions", "FinalRoutes", "MaximumGroupConnections", "NodeIterationAllowance",
].map(name => `experimentalInteraction${name}`)

/** Repair04 guards require explicit colocated vias; P9 permits compressed edges. */
export function getInteractionGuardRoutes(routes:HighDensityRoute[],stats:CounterMap):HighDensityRoute[]{
  return routes.map(route=>{
    const points:HighDensityRoute["route"]=[]
    for(let i=0;i<route.route.length;i++){
      const point=route.route[i]!,previous=route.route[i-1]
      if(previous&&previous.z!==point.z&&previous.toNextSegmentType!=="through_obstacle"&&(previous.x!==point.x||previous.y!==point.y)){
        const endpoint=getPipeline9LayerTransitionViaEndpoint({hdRoute:route,start:previous,end:point})
        const via=endpoint==="start"?previous:point
        points.push({x:via.x,y:via.y,z:endpoint==="start"?point.z:previous.z,traceThickness:Math.max(previous.traceThickness??route.traceThickness,point.traceThickness??route.traceThickness)})
        stats.experimentalInteractionCanonicalTransitionVertices++
      }
      points.push(point)
    }
    return {...route,route:points}
  })
}

/** Exact capsule/full-span copper and distinct-drill interaction for current paths. */
export function doInteractionRoutesConflict(input: {
  left: HighDensityRoute; right: HighDensityRoute; sameNet: boolean; clearance: number; layerCount: number; allowBlindAndBuriedVias?: boolean; viaHoleDiameter?:number; minViaHoleEdgeToViaHoleEdgeClearance?:number; stats: CounterMap
}): boolean {
  const {left,right,sameNet,clearance,stats}=input
  const a=getPipeline9RouteCopperGeometry(left,input),b=getPipeline9RouteCopperGeometry(right,input)
  if(!sameNet){
    for(const x of a.wireSegments)for(const y of b.wireSegments){
      if(x.z!==y.z)continue
      stats.experimentalInteractionCopperPrimitiveTests++
      if(minimumDistanceBetweenSegments(x.start,x.end,y.start,y.end)+1e-8 < x.width/2+y.width/2+clearance)return true
    }
    for(const [wires,vias] of [[a.wireSegments,b.viaSpans],[b.wireSegments,a.viaSpans]] as const)for(const wire of wires)for(const via of vias){
      if(wire.z<via.minZ||wire.z>via.maxZ)continue
      stats.experimentalInteractionCopperPrimitiveTests++
      if(minimumDistanceBetweenSegments(wire.start,wire.end,via.center,via.center)+1e-8 < wire.width/2+via.diameter/2+clearance)return true
    }
  }
  for(const x of a.viaSpans)for(const y of b.viaSpans){
    if(sameNet&&x.center.x===y.center.x&&x.center.y===y.center.y)continue
    // Drill spacing is independent of net and electrical layer overlap.
    // Copper annulus spacing is a separate foreign-net constraint below.
    stats.experimentalInteractionDrillPrimitiveTests=(stats.experimentalInteractionDrillPrimitiveTests??0)+1
    const distance=Math.hypot(x.center.x-y.center.x,x.center.y-y.center.y)
    const holeRadiusSum=(input.viaHoleDiameter??left.viaDiameter*0.5)/2+(input.viaHoleDiameter??right.viaDiameter*0.5)/2
    if(distance+1e-8<holeRadiusSum+(input.minViaHoleEdgeToViaHoleEdgeClearance??0.1)){
      stats.experimentalInteractionDrillConflicts=(stats.experimentalInteractionDrillConflicts??0)+1;return true
    }
    if(!sameNet&&Math.max(x.minZ,y.minZ)<=Math.min(x.maxZ,y.maxZ)){
      stats.experimentalInteractionCopperPrimitiveTests++
      if(distance+1e-8<x.diameter/2+y.diameter/2+clearance)return true
    }
  }
  return false
}

/** Merge only graph components witnessed by actual current-route conflicts. */
export function getInteractionComponents(count:number,edges:readonly [number,number][]):number[][]{
  const parent=Array.from({length:count},(_,i)=>i)
  const root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]!]!;i=parent[i]!}return i}
  for(const [a,b] of edges){const x=root(a),y=root(b);if(x!==y)parent[y]=x}
  const groups=new Map<number,number[]>()
  for(let i=0;i<count;i++){const key=root(i),group=groups.get(key);if(group)group.push(i);else groups.set(key,[i])}
  return [...groups.values()]
}

/** Actual-interaction portfolio candidate.
 * Retained paths are checked against every new proposal, not frozen as proof
 * that later paths cannot interact. They are not fed into child native search.
 */
export class Pipeline9InteractionGroupedHighDensitySolver extends IntraNodeRouteSolver {
  routes: HighDensityRoute[] = []
  readonly viaHoleDiameter:number
  readonly minViaHoleEdgeToViaHoleEdgeClearance:number
  private readonly obstacles: Obstacle[]
  private readonly layerCount: number
  private readonly boardGeometry?: HighDensityBoardGeometry
  private readonly nativeParams: NativeParams
  private readonly interactionParams: Params
  private readonly node: NodeWithPortPoints
  private readonly connectivity: ConnectivityMap
  private groups: Group[]=[]
  private groupSolver?: HighDensitySolver
  private activeGroup?: Group
  private phase: "initialize"|"plan"|"audit"="initialize"
  private auditRound=0
  private lastValidationFailure=""

  constructor(params:Params){
    super({...params,nodeWithPortPoints:params.nodePortPoints[0]!})
    if(params.nodePortPoints.length!==1||!params.connMap)throw new Error("Interaction grouping requires one node and its connectivity map")
    this.nativeParams={...params,enableInteractionGrouping:false};this.interactionParams=params
    this.obstacles=params.obstacles??[];this.layerCount=params.layerCount??2;this.boardGeometry=params.boardGeometry
    this.viaHoleDiameter=params.viaHoleDiameter??this.viaDiameter*0.5
    this.minViaHoleEdgeToViaHoleEdgeClearance=params.minViaHoleEdgeToViaHoleEdgeClearance??0.1
    if(!Number.isFinite(this.viaHoleDiameter)||this.viaHoleDiameter<=0||this.viaHoleDiameter>this.viaDiameter||!Number.isFinite(this.minViaHoleEdgeToViaHoleEdgeClearance)||this.minViaHoleEdgeToViaHoleEdgeClearance<0)throw new Error("Interaction grouping requires a valid physical via hole diameter and hole-edge clearance")
    this.MAX_ITERATIONS=20_000_000*(params.effort??1)
    this.node=params.nodePortPoints[0]!;this.connectivity=params.connMap
    for(const key of interactionCounterNames)this.stats[key]=0
    this.stats.experimentalInteractionNodeIterationAllowance=this.MAX_ITERATIONS
  }
  override getSolverName():string{return "Pipeline9InteractionGroupedHighDensitySolver"}

  private subsetNode(names:ReadonlySet<string>):NodeWithPortPoints{
    return {...this.node,portPoints:this.node.portPoints.filter(p=>names.has(p.connectionName)),
      ...(this.node.portPointsInPairs?{portPointsInPairs:this.node.portPointsInPairs.filter(([a,b])=>names.has(a.connectionName)&&names.has(b.connectionName))}:{})}
  }

  private initializeGroups():void{
    const groups=new Map<string,Set<string>>()
    for(const point of this.node.portPoints){
      const root=getCanonicalPipeline9PortRoot(point,this.connectivity)
      let names=groups.get(root);if(!names){names=new Set();groups.set(root,names)}names.add(point.connectionName)
    }
    this.groups=[...groups.values()].map((names,id)=>({id,names,work:0,changed:true}))
    this.stats.experimentalInteractionInitialGroups=this.groups.length
    this.phase="plan"
  }

  private haveConflict(left:HighDensityRoute,right:HighDensityRoute):boolean{
    this.stats.experimentalInteractionRoutePairChecks++
    const leftOwner=this.connectivity.getNetConnectedToId(left.connectionName)??getCanonicalPipeline9PortRoot(left,this.connectivity)
    const rightOwner=this.connectivity.getNetConnectedToId(right.connectionName)??getCanonicalPipeline9PortRoot(right,this.connectivity)
    return doInteractionRoutesConflict({left,right,sameNet:leftOwner===rightOwner,clearance:this.obstacleMargin,layerCount:this.layerCount,allowBlindAndBuriedVias:this.interactionParams.allowBlindAndBuriedVias,viaHoleDiameter:this.viaHoleDiameter,minViaHoleEdgeToViaHoleEdgeClearance:this.minViaHoleEdgeToViaHoleEdgeClearance,stats:this.stats})
  }

  private hasExpectedRouteMetadata(route:HighDensityRoute,node:NodeWithPortPoints,terminalMetadataAttached:boolean):boolean{
    if(route.regionId!==node.capacityMeshNodeId)return false
    for(const [point,id] of [[route.route[0],route.startPcbPortId],[route.route.at(-1),route.endPcbPortId]] as const){
      if(!point)return false
      // Route direction is independent of requested pair order. More than one
      // requested terminal may occupy a position; retain all legitimate IDs.
      const matches=node.portPoints.filter(port=>port.connectionName===route.connectionName&&port.x===point.x&&port.y===point.y&&port.z===point.z)
      const expected=matches.length===0?[undefined]:matches.map(port=>port.pcb_port_id)
      if(((terminalMetadataAttached&&this.nativeParams.preserveTerminalPcbPortIds)||id!==undefined)&&!expected.includes(id))return false
      // Native terminal locking is optional. If either metadata form is present,
      // it must still name a requested terminal at this exact routed endpoint.
      if(point.pcb_port_id!==undefined&&!expected.includes(point.pcb_port_id))return false
    }
    return true
  }

  private validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints,terminalMetadataAttached=true):boolean{
    this.stats.experimentalInteractionCandidateValidations++
    const names=new Set(node.portPoints.map(p=>p.connectionName))
    let valid=areNodePortPointPairsConnectedByRoutes(routes,node)
    for(const route of routes){
      if(!names.has(route.connectionName)||Math.abs(route.traceThickness-this.traceWidth)>1e-8||Math.abs(route.viaDiameter-this.viaDiameter)>1e-8||route.route.length<2||!this.hasExpectedRouteMetadata(route,node,terminalMetadataAttached))valid=false
      for(let i=0;i<route.route.length;i++){
        const point=route.route[i]!
        if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isInteger(point.z)||point.z<0||point.z>=this.layerCount||(node.availableZ&&!node.availableZ.includes(point.z))||(point.traceThickness!==undefined&&Math.abs(point.traceThickness-this.traceWidth)>1e-8))valid=false
      }
      const expectedPoint=node.portPoints.find(p=>p.connectionName===route.connectionName)
      if(expectedPoint?.rootConnectionName){
        const expectedRoot=getCanonicalPipeline9PortRoot(expectedPoint,this.connectivity)
        if(!route.rootConnectionName||(route.rootConnectionName!==expectedPoint.rootConnectionName&&route.rootConnectionName!==expectedRoot&&this.connectivity.getNetConnectedToId(route.rootConnectionName)!==expectedRoot))valid=false
      }
    }
    for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)if(this.haveConflict(routes[i]!,routes[j]!))valid=false
    // Also check distinct drills within one routed connection.
    for(const route of routes){
      const vias=getPipeline9RouteCopperGeometry(route,{layerCount:this.layerCount,allowBlindAndBuriedVias:this.interactionParams.allowBlindAndBuriedVias}).viaSpans
      for(let i=0;i<vias.length;i++)for(let j=i+1;j<vias.length;j++){
        const a=vias[i]!,b=vias[j]!
        if(a.center.x===b.center.x&&a.center.y===b.center.y)continue
        this.stats.experimentalInteractionDrillPrimitiveTests++
        if(Math.hypot(a.center.x-b.center.x,a.center.y-b.center.y)+1e-8<this.viaHoleDiameter+this.minViaHoleEdgeToViaHoleEdgeClearance){this.stats.experimentalInteractionDrillConflicts++;valid=false}
      }
    }
    if(!valid){this.lastValidationFailure="port pair, identity, nominal width, layer or internal copper/drill guard";this.stats.experimentalInteractionCandidateRejections++;return false}
    // External guards compare plain strings. Give guard-only copies a fresh
    // canonical namespace so an ordinary alias cannot impersonate another
    // net's canonical root key. Native routes and imported obstacles stay intact.
    const sourceIds=JSON.stringify([routes,this.obstacles,node])
    let prefix="pipeline9_interaction_guard_"
    while(sourceIds.includes(prefix))prefix=`_${prefix}`
    const ownerNames=new Map<string,string>()
    const guardOwner=(owner:string):string=>{
      const existing=ownerNames.get(owner)
      if(existing!==undefined)return existing
      const name=`${prefix}net_${ownerNames.size}`
      ownerNames.set(owner,name)
      return name
    }
    const guardRoutes=getInteractionGuardRoutes(routes,this.stats).map((route,index)=>({...route,connectionName:`${prefix}route_${index}`,rootConnectionName:guardOwner(getCanonicalPipeline9PortRoot(route,this.connectivity))}))
    const guardObstacles=this.obstacles.map(obstacle=>({...obstacle,connectedTo:[...new Set(obstacle.connectedTo.map(id=>guardOwner(this.connectivity.getNetConnectedToId(id)??id)))]}))
    const {connectedRouteNamesByObstacle,connectedObstaclesByRoute}=getObstacleRouteConnectivity({obstacles:guardObstacles,routes:guardRoutes})
    const srj:SimpleRouteJson={layerCount:this.layerCount,minTraceWidth:this.traceWidth,minViaDiameter:this.viaDiameter,minViaHoleDiameter:this.viaHoleDiameter,minViaHoleEdgeToViaHoleEdgeClearance:this.minViaHoleEdgeToViaHoleEdgeClearance,allowBlindAndBuriedVias:this.interactionParams.allowBlindAndBuriedVias,
      bounds:{minX:this.node.center.x-this.node.width/2,maxX:this.node.center.x+this.node.width/2,minY:this.node.center.y-this.node.height/2,maxY:this.node.center.y+this.node.height/2},...this.boardGeometry,
      obstacles:guardObstacles.map((obstacle,i)=>({...obstacle,connectedTo:[...obstacle.connectedTo,...connectedRouteNamesByObstacle[i]!]})),
      connections:guardRoutes.map((route,i)=>({name:route.connectionName,rootConnectionName:route.rootConnectionName,__netConnectionName:route.rootConnectionName??route.connectionName,pointsToConnect:[...[route.route[0]!,route.route.at(-1)!].map(p=>({x:p.x,y:p.y,layer:mapZToLayerName(p.z,this.layerCount)})),...connectedObstaclesByRoute[i]!.flatMap(obstacle=>{const id=obstacle.circuitJsonMetadata?.pcb_port_id;return id?[{...obstacle.center,layer:"top",pcb_port_id:id}]:[]})]}))}
    this.stats.experimentalInteractionObstacleChecks+=this.obstacles.length*routes.length
    const fixed=getFixedObstacleViolations({srj:{...srj,traces:undefined},routes:guardRoutes,traceClearance:this.obstacleMargin,viaClearance:this.obstacleMargin})
    const viaPads=getNewViaPadViolations({srj:{...srj,traces:undefined},previousRoutes:guardRoutes.map(route=>({...route,route:[],vias:[]})),routes:guardRoutes,viaClearance:this.obstacleMargin})
    const traces=guardRoutes.map((route,i)=>({type:"pcb_trace" as const,pcb_trace_id:`${route.connectionName}_${i}`,connection_name:route.connectionName,route:convertHdRouteToSimplifiedRoute(route,this.layerCount,{defaultViaHoleDiameter:this.viaHoleDiameter})}))
    const circuit=convertToCircuitJson(srj,traces)
    if(this.boardGeometry)circuit.push(createPcbBoardElement(srj))
    this.stats.experimentalInteractionBoardDrcChecks++
    const drc=getDrcErrors(circuit,{traceClearance:this.obstacleMargin,viaClearance:this.minViaHoleEdgeToViaHoleEdgeClearance,includeTraceContinuity:false})
    valid=fixed.length===0&&viaPads.length===0&&drc.errors.length===0
    if(!valid){this.lastValidationFailure=`fixed=${fixed[0]?.key??"none"}; viaPad=${viaPads[0]?.kind??"none"}; drc=${drc.errors[0]?.message??"none"}`;this.stats.experimentalInteractionCandidateRejections++}
    return valid
  }

  private startGroup(group:Group):void{
    const node=this.subsetNode(group.names)
    this.activeGroup=group
    // Native HighDensitySolver attaches PCB endpoint identities only after its
    // grow/shrink validator returns. Check supplied IDs now, require requested
    // preserved IDs again when the completed child proposal is published.
    this.groupSolver=new HighDensitySolver({...this.nativeParams,nodePortPoints:[node],growShrinkSolutionValidator:routes=>this.validateGroup(routes,node,false)})
    this.stats.experimentalInteractionGroupPlans++
    this.stats.experimentalInteractionChildAllocatedIterations+=this.groupSolver.MAX_ITERATIONS
    this.stats.experimentalInteractionMaximumGroupConnections=Math.max(this.stats.experimentalInteractionMaximumGroupConnections,group.names.size)
    this.stats.experimentalInteractionReroutedConnections+=group.names.size
  }

  private auditGroups():void{
    this.stats.experimentalInteractionAudits++
    const edges:[number,number][]=[]
    for(let i=0;i<this.groups.length;i++)for(let j=i+1;j<this.groups.length;j++){
      const a=this.groups[i]!,b=this.groups[j]!
      if(!a.routes||!b.routes)throw new Error("Interaction audit received an unsolved group")
      this.stats.experimentalInteractionGroupPairChecks++
      if(this.auditRound>0&&(a.changed||b.changed))this.stats.experimentalInteractionReservationChecks++
      let conflict=false
      for(const left of a.routes)for(const right of b.routes)if(this.haveConflict(left,right))conflict=true
      if(conflict){edges.push([i,j]);this.stats.experimentalInteractionInteractionEdges++}
    }
    this.auditRound++
    if(edges.length===0){
      this.routes=this.groups.flatMap(group=>group.routes!)
      if(!areNodePortPointPairsConnectedByRoutes(this.routes,this.node))throw new Error("Interaction grouping lost a required port pair")
      this.stats.experimentalInteractionFinalRoutes=this.routes.length
      this.solvedRoutes=this.routes;this.solved=true;this.progress=1
      return
    }
    const components=getInteractionComponents(this.groups.length,edges),next:Group[]=[]
    for(const component of components){
      if(component.length===1){const group=this.groups[component[0]!]!;group.changed=false;next.push(group);this.stats.experimentalInteractionRetainedGroupsAtMerge++;this.stats.experimentalInteractionRetainedRoutesAtMerge+=group.routes!.length;this.stats.experimentalInteractionRetainedIterationsAtMerge+=group.work;continue}
      const names=new Set<string>();let work=0
      for(const index of component){const group=this.groups[index]!;for(const name of group.names)names.add(name);work+=group.work}
      next.push({id:this.groups[component[0]!]!.id,names,work,changed:true})
      this.stats.experimentalInteractionMergeEvents++;this.stats.experimentalInteractionMergedGroups+=component.length
    }
    this.groups=next;this.phase="plan"
  }

  override _step():void{
    if(this.phase==="initialize"){this.initializeGroups();return}
    if(this.groupSolver){
      const child=this.groupSolver,group=this.activeGroup
      if(!group)throw new Error("Interaction group solver has no owner")
      const before=child.iterations;child.step();const spent=child.iterations-before
      this.stats.experimentalInteractionChildIterations+=spent;group.work+=spent
      if(child.failed){this.stats.experimentalInteractionUnknownGroupFailures++;this.failed=true;this.error=`Interaction group candidate failed (not physical UNSAT): ${child.error}. Last physical guard: ${this.lastValidationFailure}`;return}
      if(!child.solved)return
      // Native fast paths may finish without invoking the grow/shrink callback.
      // Apply the same guard before publishing any group's current proposal.
      if(!this.validateGroup(child.routes,this.subsetNode(group.names))){
        this.stats.experimentalInteractionUnknownGroupFailures++;this.failed=true
        this.error=`Interaction group candidate rejected (not physical UNSAT): ${this.lastValidationFailure}`;return
      }
      group.routes=child.routes;this.groupSolver=undefined;this.activeGroup=undefined;return
    }
    if(this.phase==="plan"){
      const pending=this.groups.find(group=>!group.routes)
      if(pending){this.startGroup(pending);return}
      this.phase="audit";return
    }
    this.auditGroups()
  }
  computeProgress():number{
    if(this.solved)return 1
    const done=this.groups.filter(group=>group.routes).length
    return Math.max(this.progress,Math.min(0.99,(done+(this.groupSolver?.progress??0))/Math.max(1,this.groups.length)))
  }
  override tryFinalAcceptance():void{
    // BaseSolver reports allowance exhaustion as failure. There is no physical
    // infeasibility conclusion or unguarded partial-route acceptance here.
    this.stats.experimentalInteractionOuterAllowanceExhaustions++
    this.stats.experimentalInteractionUnknownGroupFailures++
  }
}

import { OBSERVER_SYMBOL } from "./instrument-core2392.mjs"
const LIMITS = Object.freeze({ invocations: 32, nativeNets: 16, representatives: 64, routePoints: 64, nullWitnesses: 16, componentValues: 32, blockerSources: 4, attachmentGridRadius: 4 })
const own = (object, key) => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
const values = array => Array.isArray(array) ? Array.from({ length: own(array, "length") }, (_, i) => own(array, String(i))) : []
function copy(value, depth = 5, ancestors = new WeakSet()) {
  if (value === undefined) return { absent: true }
  if (typeof value === "number" && !Number.isFinite(value)) return { nonfinite: String(value) }
  if (value === null || typeof value !== "object") return typeof value === "function" ? { functionOmitted: true } : value
  if (depth < 1) return { depthLimit: true }
  if (ancestors.has(value)) return { cyclicReferenceOmitted: true }
  ancestors.add(value)
  let result
  if (Array.isArray(value)) result = { values: values(value).slice(0,LIMITS.routePoints).map(v=>copy(v,depth-1,ancestors)), totalCount: own(value,"length"), truncated: own(value,"length")>LIMITS.routePoints }
  else {
    result={}
    const keys=Object.getOwnPropertyNames(value)
    for(const key of keys.slice(0,32)){const d=Object.getOwnPropertyDescriptor(value,key);result[key]=d&&"value"in d?copy(d.value,depth-1,ancestors):{accessorOmitted:true}}
    if(keys.length>32)result.omittedKeys=keys.length-32
  }
  ancestors.delete(value)
  return result
}
const fields=(object,keys)=>Object.fromEntries(keys.map(key=>[key,copy(own(object,key))]))
const mapEntries=map=>map instanceof Map?Array.from(Map.prototype.entries.call(map)):[]
const nativeName=connection=>own(connection,"name")
const connectionNames=input=>values(own(input,"connections")).map(nativeName)

export function createBus58NegotiationObserver({isActive=()=>true}={}) {
  const invocations=new WeakMap(), inputOwners=new WeakMap(), searchStates=new WeakMap(), bounded=new WeakMap()
  const stageStats=new Map(), represented=new Set(), seenBlocks=new Set()
  let enabled=true, nextInvocation=1, nextSearch=1, nextPipeline=1
  const pipelineIds=new WeakMap()
  const report={schemaVersion:2,limits:LIMITS,instrumentedBaseline:true,observerError:null,counts:{},pipelineAttempts:[],invocations:[],searchSummary:[],searchRepresentatives:[],firstBlocks:[],viaHoleRejections:[],escapeHoleConflicts:[],compatibilityConflicts:[],expandedEmpty:[],variantExceptions:[],fatalWitnesses:[],boundedResults:[],completedSurfaceResults:[],coverage:{representativeLimitReached:false,invocationLimitReached:false,cappedWitnessKinds:[],unassociatedSearches:0},caveats:["Discrete attachment/component failures are not physical impossibility.","Early failed searches can recover; final nulls and per-net successful outcomes are reported separately.","No native geometry predicate, component lookup, point getter, or solver step is re-run for diagnostics.","Configured budgets remain unchanged; observer work may consume elapsed-time budget."]}
  const capped=kind=>{if(!report.coverage.cappedWitnessKinds.includes(kind))report.coverage.cappedWitnessKinds.push(kind)}
  const pipelineInfo=pipeline=>{
    if(!pipelineIds.has(pipeline))pipelineIds.set(pipeline,nextPipeline++)
    return {pipelineId:pipelineIds.get(pipeline),...fields(pipeline,["attempt","iterations","MAX_ITERATIONS","carrierStrategy","phase","routingDeadline"])}
  }
  const getInvocation=(invocation,input)=>invocation!==undefined?invocations.get(invocation):inputOwners.get(input)
  const searchState=search=>{
    if(!searchStates.has(search))searchStates.set(search,{id:nextSearch++,components:[],tag:null,reason:null,pendingBlock:null,outcomeRecorded:false})
    return searchStates.get(search)
  }
  const snapshotTrace=trace=>fields(trace,["pcb_trace_id","connection_name","source_trace_id","route"])
  const endpoints=connection=>fields(connection,["name","source_trace_id","pointsToConnect","traceWidth"])
  const invocationPacket=state=>state?{invocationId:state.id,kind:state.kind,pipeline:state.pipeline,allowPadEdgeSites:state.allowPadEdgeSites}:null
  const localGrid=(search,point)=>{
    const nx=own(search,"nx"),ny=own(search,"ny"),step=own(search,"stepSize"),origin=own(search,"origin")
    const px=own(point,"x"),py=own(point,"y"),ox=own(origin,"x"),oy=own(origin,"y")
    if(![nx,ny,step,px,py,ox,oy].every(Number.isFinite)||step<=0)return{unavailable:true}
    const cx=Math.round((px-ox)/step),cy=Math.round((py-oy)/step),cells=[]
    for(let y=cy-LIMITS.attachmentGridRadius;y<=cy+LIMITS.attachmentGridRadius;y++)for(let x=cx-LIMITS.attachmentGridRadius;x<=cx+LIMITS.attachmentGridRadius;x++){
      if(x<0||y<0||x>=nx||y>=ny)continue
      const id=x+y*nx
      cells.push([id,own(own(search,"xs"),String(x)),own(own(search,"ys"),String(y)),own(own(search,"blocked"),String(id))])
    }
    return {nearestCell:[cx,cy],columns:["id","x","y","blocked"],cells}
  }
  const snapshotSearch=(search,state)=>({searchId:state.id,stage:state.tag?.stage,callerMetadata:state.tag?.metadata,invocation:invocationPacket(state.invocation),connection:endpoints(state.tag?.connection??own(own(search,"scene"),"connection")),reason:state.reason??null,...fields(search,["start","end","solved","failed","expanded","maxLength","penalty","packageGrid","stepSize","origin","gridBounds","nx","ny","startAttachments","endAttachments","alternateAttachments"]),componentResults:copy(state.components),componentValuesTruncated:state.componentsTruncated===true,startNeighborhood:localGrid(search,own(search,"start")),endNeighborhood:localGrid(search,own(search,"end"))})
  const statFor=state=>{
    const name=nativeName(state.tag?.connection??own(own(state.search,"scene"),"connection"))??"unresolved"
    const key=`${state.invocation?.id??"unassociated"}|${name}|${state.tag?.stage??"unclassified"}`
    if(!stageStats.has(key)){
      const row={key,invocationId:state.invocation?.id??null,nativeNet:name,stage:state.tag?.stage??"unclassified",searches:0,solved:0,failedByReason:{},interruptedBeforeCancel:0,expandedAtCompletedSearches:0,lastOutcome:null}
      stageStats.set(key,row);report.searchSummary.push(row)
    }
    return stageStats.get(key)
  }
  const recordOutcome=(search,state,outcome)=>{
    if(!state.tag||state.outcomeRecorded)return
    state.outcomeRecorded=true
    const row=statFor(state)
    row.lastOutcome={outcome,reason:state.reason,searchId:state.id,expanded:copy(own(search,"expanded")),solved:copy(own(search,"solved")),failed:copy(own(search,"failed"))}
    if(outcome==="solved")row.solved++
    else if(outcome==="failed")row.failedByReason[state.reason??"unknown"]=(row.failedByReason[state.reason??"unknown"]??0)+1
    else row.interruptedBeforeCancel++
    const expanded=own(search,"expanded");if(Number.isFinite(expanded))row.expandedAtCompletedSearches+=expanded
    const key=`${row.key}|${outcome}|${state.reason??"none"}`
    if(!represented.has(key)){
      represented.add(key)
      if(report.searchRepresentatives.length<LIMITS.representatives)report.searchRepresentatives.push({outcome,nativeFailedAssignmentPending:outcome==="failed"&&own(search,"failed")!==true,...snapshotSearch(search,state)})
      else report.coverage.representativeLimitReached=true
    }
  }
  const sourceMatches=(input,copper)=>{
    if(!copper)return[]
    const matches=[]
    for(const [index,obstacle]of values(own(input,"obstacles")).entries()){
      if(own(copper,"a")===own(obstacle,"center")&&own(copper,"b")===own(obstacle,"center"))matches.push({kind:"obstacle_center_identity",index,obstacle:copy(obstacle)})
      if(matches.length>=LIMITS.blockerSources)return matches
    }
    for(const [index,trace]of values(own(input,"traces")).entries()){
      const points=values(own(trace,"route"))
      if(points.includes(own(copper,"a"))&&points.includes(own(copper,"b")))matches.push({kind:"trace_endpoint_identities",index,trace:snapshotTrace(trace)})
      if(matches.length>=LIMITS.blockerSources)break
    }
    return matches
  }
  const recordBlock=(details,state)=>{
    const context=own(details,"context"),scene=own(details,"scene"),input=own(scene,"input"),connection=own(context,"connection")??own(scene,"connection")
    const invocation=state?.invocation??inputOwners.get(input),name=nativeName(connection)??"unresolved",kind=own(context,"kind")
    const key=`${invocation?.id??"unassociated"}|${name}|${kind}`
    if(seenBlocks.has(key))return
    seenBlocks.add(key)
    if(report.firstBlocks.length>=LIMITS.nativeNets*4){capped("firstBlocks");return}
    const copper=own(details,"copper")
    report.firstBlocks.push({key,kind,searchId:state?.id??null,invocation:invocationPacket(invocation),reason:own(details,"reason"),connection:endpoints(connection),probe:fields(context,["terminal","gridId","path","pad","owner","point","end","targetLayer","alignSurfaceGrid","allowPadEdgeSites"]),query:fields(details,["a","b","margin"]),scene:fields(scene,["width","margin"]),copper:copy(copper),actualInputIdentityMatches:sourceMatches(input,copper),interpretation:"A native candidate rejection, not proof all alternatives are blocked."})
  }
  const observe=(event,details)=>{
    if(!enabled)return
    try{
      if(!isActive())return
      report.counts[event]=(report.counts[event]??0)+1
      const search=own(details,"search")
      if(event==="pipeline_prepare"){
        const pipeline=own(details,"pipeline"),info=pipelineInfo(pipeline),input=own(pipeline,"routingInput")
        inputOwners.set(input,{pipeline:info})
        if(report.pipelineAttempts.length<16)report.pipelineAttempts.push({...info,connectionNames:connectionNames(input),inputCounts:{connections:values(own(input,"connections")).length,traces:values(own(input,"traces")).length,obstacles:values(own(input,"obstacles")).length},inputContract:fields(input,["bounds","outline","minTraceWidth","minTraceToPadEdgeClearance","defaultObstacleMargin","minViaPadDiameter","minViaHoleDiameter","minTraceToHoleEdgeClearance","allowBlindAndBuriedVias"])})
      }else if(event==="lane_child_tag"){
        const child=own(details,"child"),input=own(child,"input"),info=pipelineInfo(own(details,"pipeline"));inputOwners.set(input,{pipeline:info})
      }else if(event==="lane_negotiation_start"||event==="site_pass_start"){
        const invocation=own(details,"invocation"),stateObject=own(invocation,"state"),input=own(invocation,"input")??own(stateObject,"native"),parent=inputOwners.get(input),options=own(invocation,"options")
        if(report.invocations.length>=LIMITS.invocations){report.coverage.invocationLimitReached=true;if(input)inputOwners.set(input,{omitted:true,pipeline:parent?.pipeline??null});return}
        const row={id:nextInvocation++,kind:event==="site_pass_start"?"generated_sites":"initial_lanes",pipeline:parent?.pipeline??null,allowPadEdgeSites:copy(own(options,"allowPadEdgeSites")),expectedNativeNets:connectionNames(input),visitedNativeNets:[],nullReasons:[],endpointDomains:[],finalResult:null}
        invocations.set(invocation,row);report.invocations.push(row)
        if(input)inputOwners.set(input,row)
      }else if(event==="site_endpoint_options"){
        const state=invocations.get(own(details,"invocation"));if(!state)return
        const name=nativeName(own(details,"connection"));if(!state.visitedNativeNets.includes(name))state.visitedNativeNets.push(name)
        const ends=values(own(details,"ends"));state.endpointDomains.push({nativeNet:name,endCounts:ends.map(end=>values(end).length),carrierLayers:copy(own(details,"carrierLayers"))})
        const single=own(details,"single");if(single)inputOwners.set(single,state)
      }else if(event==="search_tag"){
        const state=searchState(search);if(state.tag)return
        state.search=search;state.tag={stage:own(details,"stage"),connection:own(details,"connection"),metadata:fields(details,["layer","end","alignSurfaceGrid","allowPadEdgeSites","pad","point"])};state.invocation=getInvocation(own(details,"invocation"),own(details,"input")??own(own(search,"scene"),"input"))
        if(!state.invocation?.id)report.coverage.unassociatedSearches++
        const name=nativeName(state.tag.connection);if(state.invocation?.visitedNativeNets&&!state.invocation.visitedNativeNets.includes(name))state.invocation.visitedNativeNets.push(name)
        statFor(state).searches++
        if(state.pendingBlock){recordBlock(state.pendingBlock,state);state.pendingBlock=null}
        if(state.reason)recordOutcome(search,state,"failed")
        else if(own(search,"solved")===true)recordOutcome(search,state,"solved")
      }else if(event==="component_value"){
        const state=searchState(search),id=own(own(details,"attachment"),"id"),value=own(details,"value"),side=own(details,"side"),existing=state.components.find(entry=>entry.id===id)
        if(existing){existing.lastValue=value;existing.calls++;if(!existing.sides.includes(side))existing.sides.push(side)}
        else if(state.components.length<LIMITS.componentValues)state.components.push({id,firstValue:value,lastValue:value,calls:1,sides:[side]})
        else{state.componentsTruncated=true;capped("componentValues")}
      }else if(event==="search_failed"||event==="search_solved"){
        const state=searchState(search);state.search=search;if(event==="search_failed")state.reason=own(details,"reason")
        if(state.tag)recordOutcome(search,state,event==="search_solved"?"solved":"failed")
      }else if(event==="search_probe_end"){
        const state=searchState(search);if(!state.tag)return
        const interrupted=own(search,"solved")!==true&&own(search,"failed")!==true
        if(interrupted){state.reason="caller_work_limit_before_cancel";recordOutcome(search,state,"interrupted")}
        const row=statFor(state);row.lastCallerProbe={stepsCounter:own(details,"steps"),limit:own(details,"limit"),attempts:copy(own(details,"attempts")),interruptedBeforeCancel:interrupted,counterIncludesPostincrementComparison:true}
      }else if(event==="probe_blocked"){
        const context=own(details,"context"),ownerSearch=own(context,"search")
        if(ownerSearch){const state=searchState(ownerSearch);if(state.tag)recordBlock(details,state);else if(!state.pendingBlock)state.pendingBlock=details}
        else recordBlock(details,null)
      }else if(event==="via_hole_rejected"){
        const name=nativeName(own(details,"connection")),state=inputOwners.get(own(details,"input")),key=`${state?.id??"unassociated"}|${name}|hole`
        if(!seenBlocks.has(key)&&report.viaHoleRejections.length<LIMITS.nativeNets*2){seenBlocks.add(key);report.viaHoleRejections.push({invocation:invocationPacket(state),connection:endpoints(own(details,"connection")),...fields(details,["pad","owner","point","via","end","targetLayer","alignSurfaceGrid","allowPadEdgeSites","distance","required"])})}
      }else if(event==="site_variant_exception"){
        if(report.variantExceptions.length<16)report.variantExceptions.push({invocation:invocationPacket(invocations.get(own(details,"invocation"))),connection:endpoints(own(details,"connection")),variant:own(details,"variant"),error:copy(own(details,"error"))})
      }else if(event==="expanded_sites_empty"){
        if(report.expandedEmpty.length<16)report.expandedEmpty.push({invocation:invocationPacket(inputOwners.get(own(details,"input"))),connection:endpoints(own(details,"connection")),...fields(details,["targetLayer","allowPadEdgeSites"]),endCounts:values(own(details,"ends")).map(end=>values(end).length),reason:"No returned expanded endpoint domain; unobserved guards/postprocessing may also reject sites."})
      }else if(event==="lane_null"||event==="site_null"||event==="site_pruned_empty"||event==="site_result"){
        const state=invocations.get(own(details,"invocation")),reason=own(details,"reason")??(event==="site_pruned_empty"?"compatibility_pruned_domain":own(details,"result")===null?"candidate_pool_incomplete":"complete")
        if(state){if(reason!=="complete")state.nullReasons.push(reason);if(event==="site_result")state.finalResult=own(details,"result")===null?"null":"complete";else if(event==="lane_null"||event==="site_null")state.finalResult="null"}
        if(reason==="complete")return
        if(report.fatalWitnesses.length<LIMITS.nullWitnesses)report.fatalWitnesses.push({event,reason,invocation:invocationPacket(state),connection:endpoints(own(details,"connection")),...fields(details,["available","iteration","index","carrierLayers"]),ends:values(own(details,"ends")).map(end=>({totalCount:values(end).length,samples:values(end).slice(0,2).map(site=>({point:copy(own(site,"point")),escape:snapshotTrace(own(site,"escape"))})),truncated:values(end).length>2})),entryNames:values(own(details,"entries")).map(entry=>own(entry,"0")),routedNames:mapEntries(own(details,"routed")).map(([name])=>name),queueNames:values(own(details,"queue")).map(item=>nativeName(item)??nativeName(values(own(item,"connections"))[0])),visits:copy(mapEntries(own(details,"visits"))),variantCounts:mapEntries(own(details,"variants")).map(([name,choices])=>[name,values(choices).length]),poolCounts:mapEntries(own(details,"pools")).map(([name,choices])=>[name,values(choices).length])})
      }else if(event==="escape_hole_conflict"){
        if(report.escapeHoleConflicts.length<8)report.escapeHoleConflicts.push({firstNames:values(own(details,"first")).map(t=>own(t,"connection_name")),secondNames:values(own(details,"second")).map(t=>own(t,"connection_name")),...fields(details,["a","b"])})
      }else if(event==="site_copper_conflict"){
        if(report.compatibilityConflicts.length<8)report.compatibilityConflicts.push({invocation:invocationPacket(invocations.get(own(details,"invocation"))),conflict:copy(own(details,"conflict"))})
      }else if(event==="bounded_tag")bounded.set(own(details,"generator"),{stage:own(details,"stage"),maxSteps:own(details,"maxSteps"),pipeline:inputOwners.get(own(details,"input"))?.pipeline??null})
      else if(event==="bounded_result"){
        const tag=bounded.get(own(details,"generator"));if(tag&&report.boundedResults.length<16)report.boundedResults.push({...tag,limit:own(details,"limit"),stepsCounter:own(details,"steps"),counterIncludesPostincrementComparison:true,completed:own(own(details,"state"),"done"),truncated:own(own(details,"state"),"done")===false,completedNull:own(own(details,"state"),"done")===true&&own(details,"result")===null})
      }else if(event==="surface_done"&&report.completedSurfaceResults.length<16)report.completedSurfaceResults.push({...pipelineInfo(own(details,"pipeline")),resultWasNull:own(own(details,"state"),"value")===null})
    }catch(error){report.observerError={event,error:copy(error)};enabled=false}
  }
  return {observe,install(){globalThis[Symbol.for(OBSERVER_SYMBOL)]=observe},getReport(){
    for(const [kind,limit,event]of [["firstBlocks",LIMITS.nativeNets*4,"probe_blocked"],["viaHoleRejections",LIMITS.nativeNets*2,"via_hole_rejected"],["escapeHoleConflicts",8,"escape_hole_conflict"],["compatibilityConflicts",8,"site_copper_conflict"],["expandedEmpty",16,"expanded_sites_empty"],["variantExceptions",16,"site_variant_exception"],["boundedResults",16,"bounded_result"],["completedSurfaceResults",16,"surface_done"]])if(report[kind].length>=limit&&(report.counts[event]??0)>limit)capped(kind)
    if(report.fatalWitnesses.length>=LIMITS.nullWitnesses)capped("fatalWitnesses")
    const attributedOutcomes=report.searchSummary.reduce((sum,row)=>sum+row.solved+Object.values(row.failedByReason).reduce((a,b)=>a+b,0),0)
    report.coverage.untaggedOutcomeEvents=Math.max(0,(report.counts.search_solved??0)+(report.counts.search_failed??0)-attributedOutcomes)
    return {schemaVersion:report.schemaVersion,summary:{limits:report.limits,instrumentedBaseline:true,counts:report.counts,pipelineAttempts:report.pipelineAttempts,invocations:report.invocations,searchSummary:report.searchSummary,boundedResults:report.boundedResults,completedSurfaceResults:report.completedSurfaceResults,coverage:report.coverage,observerError:report.observerError,observerCompletedWithoutError:report.observerError===null,notReachedByInvocation:report.invocations.map(row=>({invocationId:row.id,nativeNets:row.expectedNativeNets.filter(name=>!row.visitedNativeNets.includes(name))})),observedCompletedNull:report.completedSurfaceResults.some(row=>row.resultWasNull),observedBoundedResult:report.boundedResults.length>0,caveats:report.caveats},witnesses:{fatalWitnesses:report.fatalWitnesses,searchRepresentatives:report.searchRepresentatives,firstBlocks:report.firstBlocks,viaHoleRejections:report.viaHoleRejections,escapeHoleConflicts:report.escapeHoleConflicts,compatibilityConflicts:report.compatibilityConflicts,expandedEmpty:report.expandedEmpty,variantExceptions:report.variantExceptions}}}}
}

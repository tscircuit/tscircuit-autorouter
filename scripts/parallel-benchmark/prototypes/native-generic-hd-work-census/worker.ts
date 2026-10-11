const sourceRoot=process.env.GENERIC_HD_CENSUS_COPY
if(!sourceRoot) throw new Error("GENERIC_HD_CENSUS_COPY must identify the isolated instrumented source")
await import(`${sourceRoot}/lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pipeline9LocalWorker.ts`)
const counters=await import(`${sourceRoot}/lib/genericHdWorkCounters.ts`)
const nativeMessage=globalThis.onmessage!,nativePost=globalThis.postMessage.bind(globalThis)

globalThis.postMessage=(message:unknown):void=>{
  if(message&&typeof message==="object"&&"ok" in message) nativePost({response:message,census:counters.snapshot()})
  else nativePost(message)
}
onmessage=(event:MessageEvent):void=>{
  // The actual copied worker entry handles the original ordinary HD job.
  // Native constructors/caps, selected100 loops and method bindings remain.
  Reflect.apply(nativeMessage,globalThis,[event])
}

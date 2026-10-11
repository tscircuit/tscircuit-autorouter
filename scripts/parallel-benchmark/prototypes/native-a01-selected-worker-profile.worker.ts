import { profile } from "bun:jsc"

const sourceRoot=process.env.A01_PROFILE_ROOT
if(!sourceRoot) throw new Error("A01_PROFILE_ROOT must identify the frozen autorouter source tree")
await import(`${sourceRoot}/lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pipeline9LocalWorker.ts`)
const nativeMessage=globalThis.onmessage!,nativePost=globalThis.postMessage.bind(globalThis)
let complete!:(value:unknown)=>void
let response:unknown

// Observe only the outer completed task. Native solver methods, intrinsic
// contracts, inputs, original work caps and selected100 loops are unchanged.
globalThis.postMessage=(message:unknown):void=>{
  if(message&&typeof message==="object"&&"ok" in message) {
    response=message
    complete(null)
  } else nativePost(message)
}

onmessage=(event:MessageEvent):void=>{
  profile(async():Promise<void>=>{
    const finished=new Promise((resolve):void=>{complete=resolve})
    Reflect.apply(nativeMessage,globalThis,[event])
    await finished
  },1000).then((report):void=>nativePost({response,report}),
    (error:unknown):void=>nativePost({error:error instanceof Error?error.stack:String(error)}))
}

import { deserializePipeline9SharedContext, type Pipeline9SharedContextReference } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9SharedContextCodec"

self.onmessage = (event: MessageEvent<{ context?: object; sharedContext?: Pipeline9SharedContextReference }>): void => {
  void (async (): Promise<void> => {
    const context = event.data.sharedContext ? await deserializePipeline9SharedContext(event.data.sharedContext) : event.data.context
    self.postMessage(context)
  })()
}

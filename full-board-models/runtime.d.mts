import type { SimpleRouteJson, SimplifiedPcbTrace } from "@tscircuit/core"
export declare class AutoroutingPipelineSolver9_PreloadedTraceGraph {
  constructor(input: SimpleRouteJson, options: { cacheProvider: null })
  solved: boolean
  failed: boolean
  error: string | null
  step(): void
  getCurrentPhase(): string
  getOutputSimplifiedPcbTraces(): SimplifiedPcbTrace[]
  getOutputSimpleRouteJson(): SimpleRouteJson
}

import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../lib/types"

export type CorpusSplit = "train" | "validation" | "test"
export type CorpusKind = "control" | "stress" | "infeasible"
export type CorpusSeriesComponent = {
  componentId: string
  polarity: "positive" | "negative"
  upstreamConnectionName: string
  downstreamConnectionName: string
  inputPortId: string
  outputPortId: string
}
export type CorpusLogicalPath = {
  pairId: string
  positiveConnectionNames: string[]
  negativeConnectionNames: string[]
  seriesComponents: CorpusSeriesComponent[]
}
export type CorpusSample = {
  sampleId: string
  srj: SimpleRouteJson
  provenance: {
    familyId: string
    split: CorpusSplit
    sourcePath: string
    sourceSha256: string
    seed: number
    mutation: Record<string, string | number | boolean>
  }
  kind: CorpusKind
  fingerprint: string
  logicalPaths: CorpusLogicalPath[]
  /** Constructive straight-copper witness, checked separately from routed solver output. */
  controlWitness?: SimplifiedPcbTraces
}
export type CorpusOptions = {
  seed: number
  count: number
  sourceRoot: string
}
export type CorpusManifest = {
  schemaVersion: 1
  generatorVersion: 2
  seed: number
  sampleCount: number
  samples: {
    sampleId: string
    path: string
    split: CorpusSplit
    kind: CorpusKind
    familyId: string
    fingerprint: string
  }[]
}

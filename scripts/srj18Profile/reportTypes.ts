export type SolverRecord = {
  id: number; parentId: number | null; solver: string; stage: string;
  nodeId: string | null; inclusiveMs: number; winningSolverId: number | null;
  nodeAttribution?: "single_node_wrapper_descendant" | "wrapper_ancestor";
  iterations?: number; solved?: boolean; failed?: boolean; error?: string | null;
  progress?: number; cacheHit?: boolean; growthAttempts?: number;
  hyperParameters?: Record<string, unknown>; stats?: Record<string, unknown>;
}
export type MethodRecord = {
  solverId: number; owner: string; method: string; stage: string;
  calls: number; inclusiveMs: number; selfMs: number; maxCallMs: number;
}
export type SampleResult = {
  schemaVersion?: number;
  sampleId: string; effort: number; detailed: boolean; inputSha256: string;
  inputConnections: number; inputObstacles: number; layerCount: number;
  solved: boolean; failed: boolean; error: string | null;
  durationMs: number; constructionDurationMs: number; outputDurationMs: number;
  validationDurationMs: number; cpuUserMs: number; cpuSystemMs: number;
  peakRssBytes: number; iterations: number;
  outputSha256: string | null; outputTraceCount: number | null;
  relaxedDrcErrors: unknown[] | null;
  highDensityStats: Record<string, unknown> | null;
  stages: { stage: string; durationMs: number; steps: number; status: string; internalDurationMs: number | null }[];
  nodeTimings: { nodeId: string; durationMs: number; steps: number; status: string; winningSolver: string | null; resizeCount: number | null }[];
  highDensityNodes: { capacityMeshNodeId: string; center: { x: number; y: number }; width: number; height: number; portPointCount: number; connectionCount: number; nodePf: number | null }[];
  profile: { solvers: SolverRecord[]; methods: MethodRecord[] } | null;
}
export type ClassTiming = {
  sampleId: string; stage: string; solver: string; records: number;
  constructions: number; stepCalls: number; iterations: number | null;
  selfMs: number; constructionSelfMs: number; solved: number; failed: number;
  unfinished: number; zeroStepRecords: number; cacheHits: number;
}
export type NodeSolverTiming = {
  sampleId: string; nodeId: string; stage: string; solver: string;
  selfMs: number; constructionSelfMs: number; constructions: number;
  stepCalls: number; iterations: number; records: number;
}
export type SampleSummary = {
  sampleId: string; runs: number; medianMs: number; minMs: number; maxMs: number;
  cpuMedianMs: number; peakRssBytes: number; solved: boolean; drcErrors: number | null;
  outputParity: boolean | null; outcomeParity: boolean | null; error: string | null; detailedMs: number | null; overheadRatio: number | null;
  connections: number; obstacles: number; highDensityNodes: number;
}
export type StageSummary = { stage: string; durationMs: number; sharePercent: number; maxSampleMs: number; maxSample: string; internalDurationMs: number; omittedByInternalMs: number }
export type SampleStageSummary = { sampleId: string; stage: string; durationMs: number; sharePercent: number; status: string; steps: number; internalDurationMs: number; omittedByInternalMs: number }
export type NodeSummary = {
  sampleId: string; nodeId: string; medianMs: number; minMs: number; maxMs: number;
  status: string; winningSolver: string | null; resizeCount: number | null;
  totalRecordedGrowthAttempts: number | null; regionalRecovery: boolean | null;
  width: number; height: number; x: number; y: number; ports: number;
  connections: number; nodePf: number | null;
}

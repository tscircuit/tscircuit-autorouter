use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::Tsify;

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairSrj(#[tsify(type = "import('high-density-repair03/lib').SimpleRouteJson")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairConnectivity(#[tsify(type = "{ idToNetMap: Record<string, string>; netMap?: Record<string, string[]> } | null | undefined")] pub Option<Value>);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairRoutes(#[tsify(type = "import('high-density-repair03/lib').HighDensityRoute[]")] pub Vec<Value>);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairPortfolioInput(#[tsify(type = "Omit<import('high-density-repair03/lib').GlobalDrcBranchPortfolioSolverParams, 'drcEvaluator' | 'viaInPadDrcEvaluator' | 'referenceDrcEvaluator' | 'autoroutingDrcEngine' | 'connMap'>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairDescriptor(#[tsify(type = "Record<string, unknown>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairSnapshot(#[tsify(type = "import('high-density-repair03/lib').DrcSnapshot")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RepairPortfolioState {
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub max_iterations: usize,
    pub progress: f64,
    #[tsify(type = "Record<string, unknown> & { indexedDrcEvaluationCount: number; indexedDrcCacheHitCount: number; indexedDrcEvaluationTimeMs: number; indexedDrcCandidateCacheSize: number }")]
    pub stats: Value,
}

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairDebugState(#[tsify(type = "Record<string, unknown>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct DrcSrj(#[tsify(type = "Record<string, unknown>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct DrcOptions(#[tsify(type = "Omit<import('high-density-repair03/lib').AutoroutingDrcEngineOptions, 'connMap'>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct DrcTraces(#[tsify(type = "import('high-density-repair03/lib').SimplifiedPcbTraces")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct DrcResult(#[tsify(type = "import('high-density-repair03/lib').AutoroutingDrcResult")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct CandidateProps(#[tsify(type = "Omit<import('../ts/types').HighDensitySolverA01Props, 'initialPenaltyFn'> | Omit<import('../ts/types').HighDensitySolverA03Props, 'initialPenaltyFn'>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct IntraNodeProps(#[tsify(type = "object")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct IntraNodeHyperParameters(#[tsify(type = "Record<string, unknown>")] pub Value);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct IntraNodeRoutes(#[tsify(type = "import('../ts/types').HighDensityIntraNodeRoute[]")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct IntraNodeDiagnostics(#[tsify(type = "{ unsolvedConnections: import('../../../lib/solvers/HighDensitySolver/IntraNodeSolver').IntraNodeRouteSolver['unsolvedConnections']; rerouteAttemptsByConnection: [string, number][]; activeChildId: number | null; failedChildIds: number[] } | null")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSetup {
    pub max_iterations: usize,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct SolverGraphics(#[tsify(type = "import('graphics-debug').GraphicsObject")] pub Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairCallbackValue<'a>(#[tsify(type = "Record<string, unknown>")] pub &'a Value);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairCallbackRoutes<'a>(#[tsify(type = "RepairRoutes")] pub &'a [Value]);

#[derive(Deserialize, Serialize, Tsify)]
#[serde(transparent)]
pub struct RepairEvaluationResult(#[tsify(type = "ReturnType<import('high-density-repair03/lib').DrcEvaluator>")] pub Value);

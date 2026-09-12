use serde::{Deserialize, Serialize};
use serde_json::Value;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityValue(#[tsify(type = "unknown")] pub Value);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityRecord(#[tsify(type = "Record<string, unknown>")] pub Value);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityRoutes(
    #[tsify(type = "import('../../../lib/types/high-density-types').HighDensityIntraNodeRoute[]")]
    pub Vec<Value>,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityGraphics(
    #[tsify(type = "import('graphics-debug').GraphicsObject")] pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[expect(
    dead_code,
    reason = "Tsify emits this type for TypeScript callbacks and solver state."
)]
pub struct HighDensityNode(
    #[tsify(type = "import('../../../lib/types/high-density-types').NodeWithPortPoints")] pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityState(
    #[tsify(
        type = "{ MAX_ITERATIONS: number; iterations: number; solved: boolean; failed: boolean; progress: number | null; error: string | null }"
    )]
    pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct GrowthSnapshot(
    #[tsify(
        type = "HighDensityState & { nodeWithPortPoints: HighDensityNode; scaleFactor: number; growthAttempts: number; maxGrowthAttempts: number; stats: Record<string, unknown>; activeId: number | null; winnerId: number | null; failedIds: number[]; solvedRoutes?: HighDensityRoutes }"
    )]
    pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
pub struct CandidateIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "Record<string, CandidateIdentity | null>")]
    pub fields: Option<indexmap::IndexMap<String, Option<CandidateIdentity>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<CandidateIdentity>>,
}

#[derive(Serialize, Deserialize, Tsify)]
pub struct SpecializedInvocation {
    #[tsify(type = "unknown")]
    pub result: Value,
    #[tsify(type = "unknown[]")]
    pub args: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(type = "{ result?: CandidateIdentity | null }")]
    pub identity: Option<Value>,
}

pub fn read_value(value: Ts<HighDensityValue>) -> Result<Value, JsValue> {
    value
        .to_rust()
        .map(|value| value.0)
        .map_err(|error| JsError::new(&error.to_string()).into())
}

pub fn callback_value(value: JsValue) -> Result<Value, String> {
    Ts::<HighDensityValue>::new_unchecked(value)
        .to_rust()
        .map(|value| value.0)
        .map_err(|error| error.to_string())
}

pub fn callback_output(value: &Value) -> Result<JsValue, String> {
    HighDensityCallbackValue(value)
        .into_ts()
        .map(JsValue::from)
        .map_err(|error| error.to_string())
}

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityBoardState(
    #[tsify(
        type = "HighDensityState & { stats: Record<string, unknown>; unsolvedNodeCount: number; activeId: number | null; failedIds: number[] }"
    )]
    pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct HighDensityBoardSnapshot(
    #[tsify(
        type = "HighDensityBoardState & { routes: HighDensityRoutes; nodeSolveMetadataById: Record<string, Record<string, unknown>> }"
    )]
    pub Value,
);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteSnapshot(
    #[tsify(
        type = "Record<string, unknown> & { progress: number | null; exploredNodes: number[]; debug_nodesTooCloseToObstacle: number[]; debug_nodePathToParentIntersectsObstacle: number[]; obstacleSegmentsByLayer: [number, { z: number; A: { x: number; y: number; z: number }; B: { x: number; y: number; z: number }; minX: number; minY: number; maxX: number; maxY: number; connectedToCurrentConnection: boolean }[]][] }"
    )]
    pub Value,
);

#[derive(Serialize, Tsify)]
#[serde(transparent)]
struct HighDensityCallbackValue<'a>(#[tsify(type = "unknown")] &'a Value);

#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SingleRouteOptions(
    #[tsify(
        type = "Omit<import('../../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver').SingleRouteOptions, 'rootConnectionName' | 'regionId'> & { rootConnectionName: string | null; regionId: string | null }"
    )]
    pub Value,
);

#[wasm_bindgen(
    inline_js = "export function stringifyHighDensityMaps(value) { return JSON.stringify(value, (_key, entry) => entry instanceof Map ? Object.fromEntries(entry) : entry) }"
)]
extern "C" {
    #[wasm_bindgen(catch, js_name = stringifyHighDensityMaps)]
    fn stringify_high_density_maps(value: &JsValue) -> Result<String, JsValue>;
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "unknown")]
    #[derive(Clone)]
    pub type HighDensityMappedJsValue;
}

#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct HighDensityMappedValue(pub Value);

// Preserve the original Map replacer without an extra traversal of JS getters.
impl Tsify for HighDensityMappedValue {
    type JsType = HighDensityMappedJsValue;
    const DECL: &'static str = "unknown";

    fn from_js<T: Into<JsValue>>(value: T) -> serde_json::Result<Self> {
        use serde::de::Error;
        MAPPED_EXCEPTION.with(|stored| *stored.borrow_mut() = None);
        let text = stringify_high_density_maps(&value.into()).map_err(|error| {
            MAPPED_EXCEPTION.with(|stored| *stored.borrow_mut() = Some(error));
            serde_json::Error::custom("High-density JSON serialization failed")
        })?;
        serde_json::from_str(&text)
    }
}

thread_local! {
    static MAPPED_EXCEPTION: std::cell::RefCell<Option<JsValue>> = const { std::cell::RefCell::new(None) };
}

pub fn read_mapped_value(value: Ts<HighDensityMappedValue>) -> Result<Value, JsValue> {
    value.to_rust().map(|value| value.0).map_err(|error| {
        MAPPED_EXCEPTION
            .with(|stored| stored.borrow_mut().take())
            .unwrap_or_else(|| JsError::new(&error.to_string()).into())
    })
}

pub fn callback_mapped_value(value: JsValue) -> Result<Value, JsValue> {
    read_mapped_value(Ts::<HighDensityMappedValue>::new_unchecked(value))
}

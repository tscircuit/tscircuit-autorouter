//! Live JavaScript storage at the public mutation boundary. Keeping handles here
//! avoids copying the scene or replacing caller-owned Maps and nested objects.
use js_sys::{Array, Function, Reflect};
use wasm_bindgen::{JsCast, JsValue};

const PROPERTY_NAMES: [&str; 39] = [
    "x",
    "y",
    "z",
    "width",
    "height",
    "center",
    "orientation",
    "x1",
    "y1",
    "x2",
    "y2",
    "length",
    "_containsTarget",
    "portPoints",
    "connectionNodeIds",
    "some",
    "sort",
    "ownerPairsToProcess",
    "rebuildNodes",
    "solved",
    "shift",
    "currentOwnerPairBeingProcessed",
    "mapOfOwnerPairToSharedEdge",
    "get",
    "obstacles",
    "mapOfOwnerPairToPortPoints",
    "ownerNodeIds",
    "inputNodesWithPortPoints",
    "set",
    "portPointId",
    "values",
    "nodeWithPortPoints",
    "portPointsInPairs",
    "redistributedNodes",
    "horizontal",
    "vertical",
    "portPoint",
    "inputNodes",
    "sharedEdge",
];
thread_local! {
    static PROPERTY_KEYS: [JsValue; 39] = std::array::from_fn(|index| JsValue::from_str(PROPERTY_NAMES[index]));
}
#[inline(always)]
pub fn property_key(key: &'static str) -> JsValue {
    let index = match key {
        "x" => 0,
        "y" => 1,
        "z" => 2,
        "width" => 3,
        "height" => 4,
        "center" => 5,
        "orientation" => 6,
        "x1" => 7,
        "y1" => 8,
        "x2" => 9,
        "y2" => 10,
        "length" => 11,
        "_containsTarget" => 12,
        "portPoints" => 13,
        "connectionNodeIds" => 14,
        "some" => 15,
        "sort" => 16,
        "ownerPairsToProcess" => 17,
        "rebuildNodes" => 18,
        "solved" => 19,
        "shift" => 20,
        "currentOwnerPairBeingProcessed" => 21,
        "mapOfOwnerPairToSharedEdge" => 22,
        "get" => 23,
        "obstacles" => 24,
        "mapOfOwnerPairToPortPoints" => 25,
        "ownerNodeIds" => 26,
        "inputNodesWithPortPoints" => 27,
        "set" => 28,
        "portPointId" => 29,
        "values" => 30,
        "nodeWithPortPoints" => 31,
        "portPointsInPairs" => 32,
        "redistributedNodes" => 33,
        "horizontal" => 34,
        "vertical" => 35,
        "portPoint" => 36,
        "inputNodes" => 37,
        "sharedEdge" => 38,
        _ => unreachable!("Uniform property key must have a fixed slot"),
    };
    PROPERTY_KEYS.with(|keys| keys[index].clone())
}

#[inline(always)]
pub fn get(value: &JsValue, key: &'static str) -> Result<JsValue, JsValue> {
    Reflect::get(value, &property_key(key))
}
#[inline(always)]
pub fn set(value: &JsValue, key: &'static str, field: &JsValue) -> Result<(), JsValue> {
    if !Reflect::set(value, &property_key(key), field)? {
        return Err(js_sys::TypeError::new("Could not assign uniform solver field").into());
    }
    Ok(())
}
pub fn array(value: &JsValue) -> &Array {
    value.unchecked_ref()
}
pub fn number(value: JsValue) -> f64 {
    value
        .as_f64()
        .unwrap_or_else(|| js_sys::Number::from(value).value_of())
}
pub fn truthy(value: &JsValue) -> bool {
    value.is_truthy()
}
pub fn call(value: &JsValue, name: &'static str, arguments: &Array) -> Result<JsValue, JsValue> {
    let method = get(value, name)?.dyn_into::<Function>()?;
    method.apply(value, arguments)
}
pub fn args(values: &[JsValue]) -> Array {
    values.iter().collect()
}
pub fn values(value: &JsValue) -> Result<js_sys::IntoIter, JsValue> {
    js_sys::try_iter(value)?.ok_or_else(|| js_sys::TypeError::new("Value is not iterable").into())
}

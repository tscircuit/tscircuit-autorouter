use crate::solvers::uniform_port_distribution_solver::live_values::*;
use js_sys::Function;
use wasm_bindgen::{closure::Closure, JsValue};

pub fn should_ignore_port_point(port_point: &JsValue, owner_node_ids: &JsValue, input_nodes: &JsValue, find_node: &Function, find_point: &Function) -> Result<bool, JsValue> {
    for owner_node_id in values(owner_node_ids)? {
        let input_node = find_node.call2(&JsValue::UNDEFINED,input_nodes,&owner_node_id?)?;
        if input_node.is_null() || input_node.is_undefined() { continue; }
        if truthy(&get(&input_node, "_containsTarget")?) { return Ok(true); }
        let input_point = find_point.call2(&JsValue::UNDEFINED,&get(&input_node,"portPoints")?,port_point)?;
        if input_point.is_null() || input_point.is_undefined() { continue; }
        let ids = get(&input_point, "connectionNodeIds")?;
        if ids.is_null() || ids.is_undefined() { continue; }
        let nodes = input_nodes.clone();
        let find = find_node.clone();
        let predicate = Closure::wrap(Box::new(move |id: JsValue| -> Result<JsValue,JsValue> {
            let node = find.call2(&JsValue::UNDEFINED,&nodes,&id)?;
            if node.is_null() || node.is_undefined() { return Ok(JsValue::UNDEFINED); }
            get(&node,"_containsTarget")
        }) as Box<dyn FnMut(JsValue) -> Result<JsValue,JsValue>>);
        if truthy(&call(&ids,"some",&args(&[predicate.as_ref().clone()]))?) { return Ok(true); }
    }
    Ok(false)
}

use capacity_autorouter::bindings::trace_simplification::high_density_route_spatial_index::{HighDensityRouteSpatialIndex, StoredSegment, StoredVia};
use std::{cell::RefCell, rc::Rc};
use indexmap::IndexMap;
use serde_json::Value;
use capacity_autorouter::bindings::trace_simplification::graph_codec::GraphCodec;
use capacity_autorouter::data_structures::{
    obstacle_tree::{NativeObstacleTree, ObstacleSpatialHashIndex, ImportedObstacleIndex, RbushNode},
};

fn bucket_key(value: &Value) -> Result<(i64, i64), String> {
    let value = value.as_str().ok_or("Spatial bucket key must be a string")?;
    let (x, y) = value.split_once('x').ok_or("Spatial bucket key must contain x")?;
    Ok((x.parse().map_err(|_| "Invalid spatial bucket x")?, y.parse().map_err(|_| "Invalid spatial bucket y")?))
}

pub(crate) fn decode_obstacle_index(value: &Value, codec: &mut GraphCodec) -> Result<Rc<RefCell<ObstacleSpatialHashIndex>>, String> {
    if value["hostQuery"].as_bool() == Some(true) {
        let id = value["indexId"].as_u64().ok_or("Host indexId missing")?;
        let query = codec.obstacle_query.clone().ok_or("Obstacle query callback missing")?;
        let mut index = ObstacleSpatialHashIndex::new(Vec::new());
        index.identity = id;
        index.storage = codec.read_obstacles(&value["storage"])?;
        index.host_query = Some(Rc::new(move |method, args| query(id,method,args)));
        return Ok(Rc::new(RefCell::new(index)));
    }
    if value["kind"] != "native" {
        let imported = match value["kind"].as_str() {
            Some("rbush") => ImportedObstacleIndex::Rbush(decode_rbush(&value["tree"], codec)?),
            Some("flatbush") => ImportedObstacleIndex::Flatbush {
                boxes: serde_json::from_value(value["boxes"].clone()).map_err(|e|e.to_string())?,
                indices: serde_json::from_value(value["indices"].clone()).map_err(|e|e.to_string())?,
                level_bounds: serde_json::from_value(value["levelBounds"].clone()).map_err(|e|e.to_string())?,
                node_size: value["nodeSize"].as_u64().ok_or("Missing nodeSize")? as usize,
                num_items: value["numItems"].as_u64().ok_or("Missing numItems")? as usize,
                items: codec.read_obstacles(&value["items"])?
            },
            _ => return Err("Unknown obstacle index kind".into()),
        };
        return Ok(Rc::new(RefCell::new(ObstacleSpatialHashIndex { identity: value["indexId"].as_u64().unwrap_or_else(capacity_autorouter::bindings::trace_simplification::types::next_identity), storage: codec.read_obstacles(&value["storage"])?, native: NativeObstacleTree::new(Vec::new()), imported: Some(imported), host_query: None })));
    }
    let mut buckets = IndexMap::new();
    for bucket in value["buckets"].as_array().ok_or("Obstacle buckets must be an array")? {
        let mut entries = Vec::new();
        for entry in bucket[1].as_array().ok_or("Obstacle bucket entries must be an array")? {
            entries.push((codec.read_obstacle(&entry[0])?, entry[1].as_u64().ok_or("Obstacle bucket index must be unsigned")? as usize));
        }
        buckets.insert(bucket_key(&bucket[0])?, entries);
    }
    let native = NativeObstacleTree {
        buckets, cell_size: value["CELL_SIZE"].as_f64().ok_or("Obstacle CELL_SIZE missing")?,
        obstacles: codec.read_obstacles(&value["obstacles"])?
    };
    Ok(Rc::new(RefCell::new(ObstacleSpatialHashIndex {
        identity: value["indexId"].as_u64().unwrap_or_else(capacity_autorouter::bindings::trace_simplification::types::next_identity), native, imported: None, host_query: None, storage: codec.read_obstacles(&value["storage"])?
    })))
}

pub(crate) fn decode_hd_route_index(value: &Value, codec: &mut GraphCodec) -> Result<Rc<RefCell<HighDensityRouteSpatialIndex>>, String> {
    let mut segment_buckets = IndexMap::new();
    let mut via_buckets = IndexMap::new();
    for bucket in value["segmentBuckets"].as_array().ok_or("Segment buckets must be an array")? {
        let mut entries = Vec::new();
        for entry in bucket[1].as_array().ok_or("Segment bucket entries must be an array")? {
            entries.push(Rc::new(StoredSegment {
                segment_id: entry["segmentId"].as_str().ok_or("Missing segmentId")?.to_owned(),
                segment: [codec.read_point(&entry["segment"][0])?, codec.read_point(&entry["segment"][1])?],
                parent_route: codec.read_route(&entry["parentRoute"])?
            }));
        }
        segment_buckets.insert(bucket_key(&bucket[0])?, entries);
    }
    for bucket in value["viaBuckets"].as_array().ok_or("Via buckets must be an array")? {
        let mut entries = Vec::new();
        for entry in bucket[1].as_array().ok_or("Via bucket entries must be an array")? {
            entries.push(Rc::new(StoredVia {
                via_id: entry["viaId"].as_str().ok_or("Missing viaId")?.to_owned(),
                x: entry["x"].as_f64().ok_or("Missing via x")?, y: entry["y"].as_f64().ok_or("Missing via y")?,
                parent_route: codec.read_route(&entry["parentRoute"])?
            }));
        }
        via_buckets.insert(bucket_key(&bucket[0])?, entries);
    }
    Ok(Rc::new(RefCell::new(HighDensityRouteSpatialIndex {
        identity: value["indexId"].as_u64().unwrap_or_else(capacity_autorouter::bindings::trace_simplification::types::next_identity), segment_buckets, via_buckets,
        cell_size: value["CELL_SIZE"].as_f64().ok_or("Missing route CELL_SIZE")?,
        maximum_copper_radius: value["maximumCopperRadius"].as_f64().ok_or("Missing maximumCopperRadius")?
    })))
}

fn decode_rbush(value: &Value, codec: &mut GraphCodec) -> Result<RbushNode,String> {
    let mut children = Vec::new();
    if let Some(values) = value["children"].as_array() {
        for child in values { children.push(decode_rbush(child,codec)?); }
    }
    let data = if value.get("data").is_some() { Some(codec.read_obstacle(&value["data"])?) } else { None };
    Ok(RbushNode {
        bounds: capacity_autorouter::bindings::trace_simplification::types::Bounds {
            min_x:value["minX"].as_f64().unwrap_or(f64::INFINITY), min_y:value["minY"].as_f64().unwrap_or(f64::INFINITY),
            max_x:value["maxX"].as_f64().unwrap_or(f64::NEG_INFINITY), max_y:value["maxY"].as_f64().unwrap_or(f64::NEG_INFINITY)
        },
        leaf:value["leaf"].as_bool().unwrap_or(false),height:value["height"].as_u64().map(|v|v as usize),children,data
    })
}

pub(crate) fn encode_obstacle_index(index: &ObstacleSpatialHashIndex, id: u64, codec: &mut GraphCodec) -> Value {
    let mut value = match &index.imported {
        Some(ImportedObstacleIndex::Rbush(root)) => serde_json::json!({"kind":"rbush","tree":encode_rbush(root,codec)}),
        Some(ImportedObstacleIndex::Flatbush { boxes,indices,level_bounds,node_size,num_items,items }) => serde_json::json!({"kind":"flatbush","boxes":boxes,"indices":indices,"levelBounds":level_bounds,"nodeSize":node_size,"numItems":num_items,"items":codec.obstacles(items)}),
        Some(ImportedObstacleIndex::BuiltFlatbush { index,items }) => {
            let (boxes,indices,level_bounds,node_size,num_items) = index.snapshot_arrays();
            serde_json::json!({"kind":"flatbush","boxes":boxes,"indices":indices,"levelBounds":level_bounds,"nodeSize":node_size,"numItems":num_items,"items":codec.obstacles(items)})
        }
        None => serde_json::json!({"kind":"native","CELL_SIZE":index.native.cell_size,"obstacles":codec.obstacles(&index.native.obstacles),"buckets":index.native.buckets.iter().map(|((x,y),entries)|serde_json::json!([format!("{x}x{y}"),entries.iter().map(|(o,i)|serde_json::json!([codec.obstacle(o),i])).collect::<Vec<_>>()])).collect::<Vec<_>>()})
    };
    value["$index"] = Value::String("obstacle".into());
    value["indexId"] = Value::from(id);
    value["storage"] = codec.obstacles(&index.storage);
    value["hostQuery"] = Value::Bool(index.host_query.is_some());
    value
}

fn encode_rbush(node: &RbushNode, codec: &mut GraphCodec) -> Value {
    let mut value = serde_json::json!({"minX":node.bounds.min_x,"minY":node.bounds.min_y,"maxX":node.bounds.max_x,"maxY":node.bounds.max_y});
    if let Some(data) = &node.data { value["data"] = codec.obstacle(data); }
    else {
        value["leaf"] = Value::Bool(node.leaf);
        if let Some(height) = node.height { value["height"] = Value::from(height); }
        value["children"] = Value::Array(node.children.iter().map(|child|encode_rbush(child,codec)).collect());
    }
    value
}

pub(crate) fn encode_hd_route_index(index: &HighDensityRouteSpatialIndex, id: u64, codec: &mut GraphCodec) -> Value {
    serde_json::json!({"$index":"route","indexId":id,"CELL_SIZE":index.cell_size,"maximumCopperRadius":index.maximum_copper_radius,
        "segmentBuckets":index.segment_buckets.iter().map(|((x,y),entries)|serde_json::json!([format!("{x}x{y}"),entries.iter().map(|entry|serde_json::json!({"segmentId":entry.segment_id,"segment":[codec.point(&entry.segment[0]),codec.point(&entry.segment[1])],"parentRoute":codec.route(&entry.parent_route)})).collect::<Vec<_>>()])).collect::<Vec<_>>(),
        "viaBuckets":index.via_buckets.iter().map(|((x,y),entries)|serde_json::json!([format!("{x}x{y}"),entries.iter().map(|entry|serde_json::json!({"viaId":entry.via_id,"x":entry.x,"y":entry.y,"parentRoute":codec.route(&entry.parent_route)})).collect::<Vec<_>>()])).collect::<Vec<_>>()})
}

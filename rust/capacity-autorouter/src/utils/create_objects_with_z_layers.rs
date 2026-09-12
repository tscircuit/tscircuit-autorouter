use std::{rc::Rc, cell::RefCell};
use serde_json::json;
use crate::bindings::trace_simplification::types::{ObstacleRef,next_identity};
use super::map_layer_name_to_z::{get_unique_valid_z_layers,get_unique_valid_z_layers_from_layer_names};
pub fn normalize_obstacles(obstacles:Vec<ObstacleRef>,layer_count:f64)->Vec<ObstacleRef>{
    let all:Vec<f64>=(0..layer_count.max(0.0).floor() as usize).map(|i|i as f64).collect();
    let all_identity = next_identity();
    obstacles.into_iter().map(|obstacle|{
        let obstacle = obstacle.borrow();
        let candidate=if obstacle.metadata.get("__zLayers").is_some_and(|v|!v.is_null()){obstacle.z_layers.clone()}
            else if obstacle.metadata.get("layers").is_some_and(|v|!v.is_null()){get_unique_valid_z_layers_from_layer_names(&obstacle.layers,layer_count)}else{all.clone()};
        let mut layers=get_unique_valid_z_layers(&candidate,layer_count);
        let layers_identity = if layers.is_empty() { layers=all.clone(); all_identity } else { next_identity() };
        let mut output=(*obstacle).clone();output.identity=next_identity();output.source_identity=Some(obstacle.identity);output.z_layers=layers;output.z_layers_identity=Some(layers_identity);
        let metadata=Rc::make_mut(&mut output.metadata);metadata["__zLayers"]=json!(output.z_layers);
        Rc::new(RefCell::new(output))
    }).collect()
}
pub fn create_objects_with_z_layers(obstacles:&[ObstacleRef],count:usize)->Vec<ObstacleRef>{normalize_obstacles(obstacles.to_vec(),count as f64)}

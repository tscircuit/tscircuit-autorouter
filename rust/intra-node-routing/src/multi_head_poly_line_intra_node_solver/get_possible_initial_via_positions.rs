use super::{compute_via_count_variants::PortPairsEntries, generate_binary_combinations::generate_binary_combinations,
    get_centroids_from_inner_box_intersections::{Segment,get_centroids_from_inner_box_intersections}};
use crate::specialized_utils::{math::{Point,SpecializedMath},get_bounds_from_node_with_port_points::Bounds};

pub struct ViaPositionVariant { pub via_positions: Vec<Point>, pub via_count_variant: Vec<usize> }

pub fn get_possible_initial_via_positions(pairs: &PortPairsEntries, bounds: &Bounds, variants: &[Vec<usize>], math: SpecializedMath) -> Result<Vec<ViaPositionVariant>, String> {
    let segments: Vec<_> = pairs.iter().map(|(_, (a,b))| Segment { start:Point{x:a.x,y:a.y},end:Point{x:b.x,y:b.y},connection_name:None }).collect();
    let centroids = get_centroids_from_inner_box_intersections(bounds,&segments,math).centroids;
    let mut result = Vec::new();
    for variant in variants {
        let count = variant.iter().sum::<usize>();
        let mut source = centroids.clone();
        if centroids.len() < count {
            source.clear();
            let rows = (count as f64).sqrt().ceil() as usize;
            let cols = rows;
            for r in 0..rows { for c in 0..cols {
                source.push(Point { x:bounds.min_x+(c+1) as f64/(cols+1) as f64*(bounds.max_x-bounds.min_x),y:bounds.min_y+(r+1) as f64/(rows+1) as f64*(bounds.max_y-bounds.min_y) });
            }}
        }
        for position_variant in generate_binary_combinations(count,source.len())? {
            let mut positions = Vec::new();
            for (index, &include) in position_variant.iter().enumerate() { if include==1 { positions.push(source[index]); } }
            result.push(ViaPositionVariant {via_positions:positions,via_count_variant:variant.clone()});
        }
    }
    Ok(result)
}

use super::{types2::MHPoint2,get_every_combination_from_choice_array::get_every_combination_from_choice_array};
use crate::bindings::high_density::specialized_utils::math::{Point,do_segments_intersect};

pub type PortPairsEntries = Vec<(String,(MHPoint2,MHPoint2))>;

pub fn compute_via_count_variants(pairs: &PortPairsEntries, segments: usize, max_vias: usize, min_vias: usize) -> Vec<Vec<usize>> {
    let mut choices = Vec::new();
    for (_, (start,end)) in pairs {
        let changes = start.z1 != end.z1;
        let counts = (0..=segments).filter(|i| changes == (i%2 != 0)).collect();
        choices.push(counts);
    }
    if choices.is_empty() { return vec![vec![]]; }
    let mut variants = get_every_combination_from_choice_array(&choices);
    variants.retain(|variant| variant.is_empty() || variant.iter().sum::<usize>() >= min_vias);
    variants.retain(|variant| pairs.iter().enumerate().all(|(i,(_, (start,_)))| start.z1 == start.z2 || variant[i] != 0));
    variants.retain(|variant| {
        for i in 0..pairs.len() {
            let (a,b) = &pairs[i].1;
            if a.z1 != a.z2 { continue; }
            for j in i+1..pairs.len() {
                let (c,d) = &pairs[j].1;
                if c.z1 != c.z2 { continue; }
                if a.z1==b.z1 && c.z1==d.z1 && a.z1==c.z1 && do_segments_intersect(Point{x:a.x,y:a.y},Point{x:b.x,y:b.y},Point{x:c.x,y:c.y},Point{x:d.x,y:d.y}) && variant[i]+variant[j]<2 { return false; }
            }
        }
        true
    });
    variants.retain(|variant| variant.iter().sum::<usize>() <= max_vias);
    variants
}

use indexmap::IndexMap;
use serde_json::{Value, json};
use autorouting_drc::math_utils::{js_min, js_max};

fn perimeter_t(p: &Value, xmin: f64, xmax: f64, ymin: f64, ymax: f64) -> f64 {
    let x = p["x"].as_f64().expect("Point x required"); let y = p["y"].as_f64().expect("Point y required");
    let w = xmax - xmin; let h = ymax - ymin; let eps = 1e-6;
    if (y - ymax).abs() < eps { return x - xmin; }
    if (x - xmax).abs() < eps { return w + (ymax - y); }
    if (y - ymin).abs() < eps { return w + h + (xmax - x); }
    if (x - xmin).abs() < eps { return 2.0 * w + h + (y - ymin); }
    let top = (y - ymax).abs(); let right = (x - xmax).abs(); let bottom = (y - ymin).abs(); let left = (x - xmin).abs();
    let min = js_min(js_min(js_min(top, right), bottom), left);
    if min == top { return js_max(0.0, js_min(w, x - xmin)); }
    if min == right { return w + js_max(0.0, js_min(h, ymax - y)); }
    if min == bottom { return w + h + js_max(0.0, js_min(w, xmax - x)); }
    2.0 * w + h + js_max(0.0, js_min(h, y - ymin))
}

fn count_chord_crossings(chords: &[[f64; 2]]) -> usize {
    if chords.len() < 2 { return 0; }
    let normalized: Vec<[f64; 2]> = chords.iter().map(|&[a,b]| if a < b { [a,b] } else { [b,a] }).collect();
    let mut crossings = 0;
    for (i, &[a,b]) in normalized.iter().enumerate() {
        for &[c,d] in &normalized[i + 1..] {
            if (a-c).abs() < 1e-6 || (a-d).abs() < 1e-6 || (b-c).abs() < 1e-6 || (b-d).abs() < 1e-6 { continue; }
            if (a < c && c < b && b < d) || (c < a && a < d && d < b) { crossings += 1; }
        }
    }
    crossings
}

pub fn get_intra_node_crossings_using_circle(node: &Value) -> Value {
    let cx = node["center"]["x"].as_f64().expect("Center x required"); let cy = node["center"]["y"].as_f64().expect("Center y required");
    let width = node["width"].as_f64().expect("Width required"); let height = node["height"].as_f64().expect("Height required");
    let xmin = cx - width / 2.0; let xmax = cx + width / 2.0; let ymin = cy - height / 2.0; let ymax = cy + height / 2.0;
    let mut groups: IndexMap<&str, Vec<&Value>> = IndexMap::new();
    for p in node["portPoints"].as_array().expect("Ports required") {
        let points = groups.entry(p["connectionName"].as_str().expect("Connection name required")).or_default();
        if !points.iter().any(|other| other["x"] == p["x"] && other["y"] == p["y"] && other["z"] == p["z"]) { points.push(p); }
    }
    let mut same_layers: Vec<(Value, Vec<[f64; 2]>)> = Vec::new(); let mut transitions = Vec::new(); let mut layer_changes = 0;
    for points in groups.values() {
        if points.len() < 2 { continue; }
        let a = points[0]; let b = points[1];
        let chord = [perimeter_t(a,xmin,xmax,ymin,ymax), perimeter_t(b,xmin,xmax,ymin,ymax)];
        if a["z"] == b["z"] {
            if let Some((_, chords)) = same_layers.iter_mut().find(|(z,_)| z == &a["z"]) { chords.push(chord); }
            else { same_layers.push((a["z"].clone(), vec![chord])); }
        } else { layer_changes += 1; transitions.push(chord); }
    }
    json!({"numSameLayerCrossings":same_layers.iter().map(|(_, chords)| count_chord_crossings(chords)).sum::<usize>(),
        "numEntryExitLayerChanges":layer_changes,"numTransitionPairCrossings":count_chord_crossings(&transitions)})
}

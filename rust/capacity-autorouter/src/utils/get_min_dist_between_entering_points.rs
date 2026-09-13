use serde_json::Value;

pub fn get_min_dist_between_entering_points(node: &Value) -> f64 {
    let mut min_dist = f64::INFINITY;
    let points = node["portPoints"].as_array().expect("node portPoints");
    for i in 0..points.len() {
        for j in i + 1..points.len() {
            let p1 = &points[i];
            let p2 = &points[j];
            if p1.get("z") != p2.get("z") {
                continue;
            }
            if p1["rootConnectionName"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
                && p1["rootConnectionName"] == p2["rootConnectionName"]
            {
                continue;
            }
            let dx =
                p1["x"].as_f64().expect("port point x") - p2["x"].as_f64().expect("port point x");
            let dy =
                p1["y"].as_f64().expect("port point y") - p2["y"].as_f64().expect("port point y");
            min_dist = min_dist.min((dx * dx + dy * dy).sqrt());
        }
    }
    if min_dist == f64::INFINITY {
        0.0
    } else {
        min_dist
    }
}

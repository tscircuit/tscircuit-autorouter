pub fn range(start: f64, end: Option<f64>, step: f64) -> Vec<f64> {
    assert!(step != 0.0, "step cannot be 0");
    let (start, end) = end.map(|end| (start, end)).unwrap_or((0.0, start));
    let mut result = Vec::new();
    let mut i = start;
    if step > 0.0 {
        while i < end { result.push(i); i += step; }
    } else {
        while i > end { result.push(i); i += step; }
    }
    result
}

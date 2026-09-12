pub fn map_layer_name_to_z(layer: &[u16], layer_count: f64) -> f64 {
    if layer == [116, 111, 112] { return 0.0; }
    if layer == [98, 111, 116, 116, 111, 109] { return layer_count - 1.0; }
    let tail = String::from_utf16_lossy(layer.get(5..).unwrap_or(&[]));
    let mut text = tail.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let mut sign = 1.0;
    if text.starts_with('-') {
        sign = -1.0;
        text = &text[1..];
    } else if text.starts_with('+') {
        text = &text[1..];
    }
    let radix = if text.starts_with("0x") || text.starts_with("0X") {
        text = &text[2..];
        16
    } else { 10 };
    let mut n = 0.0;
    let mut count = 0;
    for c in text.chars() {
        let Some(digit) = c.to_digit(radix) else { break; };
        n = n * radix as f64 + digit as f64;
        count += 1;
    }
    if count == 0 {
        f64::NAN
    } else if radix == 10 {
        sign * text[..count].parse::<f64>().expect("Decimal digit prefix")
    } else { sign * n }
}

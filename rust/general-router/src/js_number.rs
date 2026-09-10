pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() { "-Infinity" } else { "Infinity" }.to_owned();
    }
    ryu_js::Buffer::new().format(value).to_owned()
}

pub fn js_to_fixed(value: f64, fraction_digits: usize) -> String {
    assert!(fraction_digits <= 16, "fixed decimal precision exceeds supported range");
    if !value.is_finite() || value.abs() >= 1e21 {
        return js_number_to_string(value);
    }
    let negative = value < 0.0;
    let bits = value.abs().to_bits();
    let biased_exponent = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    let (mantissa, exponent) = if biased_exponent == 0 {
        (fraction as u128, -1074)
    } else {
        ((fraction | (1_u64 << 52)) as u128, biased_exponent - 1023 - 52)
    };
    let scale = 10_u128.pow(fraction_digits as u32);
    let scaled_mantissa = mantissa * scale;
    let rounded = if exponent >= 0 {
        scaled_mantissa << exponent as u32
    } else {
        let shift = (-exponent) as u32;
        if shift >= 128 {
            0
        } else {
            let quotient = scaled_mantissa >> shift;
            let remainder = scaled_mantissa & ((1_u128 << shift) - 1);
            quotient + u128::from(remainder >= (1_u128 << (shift - 1)))
        }
    };
    let sign = if negative { "-" } else { "" };
    if fraction_digits == 0 {
        format!("{sign}{rounded}")
    } else {
        format!("{sign}{}.{:0width$}", rounded / scale, rounded % scale, width = fraction_digits)
    }
}

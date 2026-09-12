use super::Matrix;

pub fn transform(matrices: &[Matrix]) -> Matrix {
    let multiply = |m1: &Matrix, m2: &Matrix| Matrix {
        a: m1.a * m2.a + m1.c * m2.b,
        c: m1.a * m2.c + m1.c * m2.d,
        e: m1.a * m2.e + m1.c * m2.f + m1.e,
        b: m1.b * m2.a + m1.d * m2.b,
        d: m1.b * m2.c + m1.d * m2.d,
        f: m1.b * m2.e + m1.d * m2.f + m1.f,
    };
    match matrices.len() {
        0 => panic!("no matrices provided"),
        1 => matrices[0],
        2 => multiply(&matrices[0], &matrices[1]),
        _ => {
            let m = multiply(&matrices[0], &matrices[1]);
            let mut next = Vec::with_capacity(matrices.len() - 1);
            next.push(m);
            next.extend_from_slice(&matrices[2..]);
            transform(&next)
        }
    }
}

pub fn compose(matrices: &[Matrix]) -> Matrix {
    transform(matrices)
}

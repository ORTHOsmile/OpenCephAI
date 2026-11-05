//! Small dense linear algebra in plain Rust (no crate; owner T1): a Cholesky factor and solve for symmetric positive
//! definite matrices, row-major n × n. Used by the personal layer's exact solve (spec §3) and the shape model (§14.3).

/// How far a matrix's two halves may disagree, as a share of its largest entry, before it is refused as not
/// symmetric. 1e-9 passes rounding from building a spread (about 1e-16 relative per step) and refuses a real mismatch.
pub const SYMMETRY_REL_TOL: f64 = 1e-9;

/// The lower factor L of A = L Lᵀ (row-major). Refuses a matrix that is not n × n, not symmetric (the factor reads
/// only the lower half, so the upper half would otherwise be ignored without a word) or not positive definite.
pub fn cholesky(a: &[f64], n: usize) -> anyhow::Result<Vec<f64>> {
    anyhow::ensure!(a.len() == n * n, "the matrix has {} values, not {n}×{n}", a.len());
    let big = a.iter().map(|v| v.abs()).fold(0.0, f64::max);
    for i in 0..n {
        for j in i + 1..n {
            let d = (a[i * n + j] - a[j * n + i]).abs();
            anyhow::ensure!(d <= SYMMETRY_REL_TOL * big,
                "the matrix is not symmetric at row {i}, column {j} ({} vs {})", a[i * n + j], a[j * n + i]);
        }
    }
    // A pivot at rounding level is a singular matrix, not a tiny positive one (a rank-deficient spread must be refused).
    let tol = 1e-12 * (0..n).map(|i| a[i * n + i].abs()).fold(0.0, f64::max);
    let mut l = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..=i {
            let mut s = a[i * n + j];
            for k in 0..j { s -= l[i * n + k] * l[j * n + k]; }
            if i == j {
                anyhow::ensure!(s > tol && s.is_finite(), "not positive definite at row {i} (pivot {s})");
                l[i * n + i] = s.sqrt();
            } else {
                l[i * n + j] = s / l[j * n + j];
            }
        }
    }
    Ok(l)
}

/// Solves L Lᵀ x = b with the factor from `cholesky`.
pub fn chol_solve(l: &[f64], n: usize, b: &[f64]) -> Vec<f64> {
    let mut y = b.to_vec();
    for i in 0..n { let mut s = y[i]; for k in 0..i { s -= l[i * n + k] * y[k]; } y[i] = s / l[i * n + i]; }
    for i in (0..n).rev() { let mut s = y[i]; for k in i + 1..n { s -= l[k * n + i] * y[k]; } y[i] = s / l[i * n + i]; }
    y
}

/// A x = b for symmetric positive definite A.
pub fn solve_spd(a: &[f64], n: usize, b: &[f64]) -> anyhow::Result<Vec<f64>> {
    anyhow::ensure!(b.len() == n, "the right-hand side has {} values, not {n}", b.len());
    Ok(chol_solve(&cholesky(a, n)?, n, b))
}

/// A X = B for symmetric positive definite A (n × n) and B (n × m, row-major); X is n × m, row-major.
pub fn solve_spd_many(a: &[f64], n: usize, b: &[f64], m: usize) -> anyhow::Result<Vec<f64>> {
    anyhow::ensure!(b.len() == n * m, "the right-hand side has {} values, not {n}×{m}", b.len());
    let l = cholesky(a, n)?;
    let mut x = vec![0.0; n * m];
    for c in 0..m {
        let col: Vec<f64> = (0..n).map(|i| b[i * m + c]).collect();
        for (i, v) in chol_solve(&l, n, &col).into_iter().enumerate() { x[i * m + c] = v; }
    }
    Ok(x)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// By hand: A = [[4,2,0],[2,5,1],[0,1,3]], x = [1,2,3], so b = [8,15,11]; L = [[2,0,0],[1,2,0],[0,0.5,√2.75]].
    #[test] fn a_hand_worked_system_is_solved() {
        let a = [4.0, 2.0, 0.0, 2.0, 5.0, 1.0, 0.0, 1.0, 3.0];
        let l = cholesky(&a, 3).unwrap();
        assert_eq!((l[0], l[3], l[4], l[7]), (2.0, 1.0, 2.0, 0.5));
        assert!((l[8] - 2.75f64.sqrt()).abs() < 1e-15);
        let x = solve_spd(&a, 3, &[8.0, 15.0, 11.0]).unwrap();
        for (g, w) in x.iter().zip([1.0, 2.0, 3.0]) { assert!((g - w).abs() < 1e-12, "{x:?}"); }
    }
    #[test] fn a_matrix_that_is_not_positive_definite_or_not_square_is_refused() {
        assert!(cholesky(&[1.0, 2.0, 2.0, 1.0], 2).unwrap_err().to_string().contains("positive definite"));
        assert!(cholesky(&[1.0, 0.0, 0.0], 2).unwrap_err().to_string().contains("2×2"));
    }
    /// The factor reads only the lower half, so a matrix whose halves disagree would be solved as a different matrix
    /// without a word. [[4,9],[1,3]]: its lower half [[4,1],[1,3]] is positive definite, so only the symmetry guard can
    /// refuse it. Positive control: the same matrix made symmetric is accepted, and a difference at rounding level
    /// (well inside SYMMETRY_REL_TOL) is accepted too.
    #[test] fn a_matrix_whose_halves_disagree_is_refused() {
        let e = cholesky(&[4.0, 9.0, 1.0, 3.0], 2).unwrap_err().to_string();
        assert!(e.contains("not symmetric"), "{e}");
        assert!(cholesky(&[4.0, 1.0, 1.0, 3.0], 2).is_ok(), "control: the symmetric version is accepted");
        assert!(cholesky(&[4.0, 1.0 + 1e-15, 1.0, 3.0], 2).is_ok(), "control: rounding-level asymmetry is accepted");
        let e = cholesky(&[4.0, 1.0 + 1e-6, 1.0, 3.0], 2).unwrap_err().to_string();
        assert!(e.contains("not symmetric") && e.contains("row 0"), "a small but real difference is refused: {e}");
        assert!(cholesky(&[4.0, f64::NAN, 1.0, 3.0], 2).is_err(), "a NaN in the unread upper half is refused");
    }
    /// SYNTHETIC: A = MᵀM + I from a seeded 40 × 33 M; the residual of A x = b is at rounding level, and the many-
    /// right-hand-side solve agrees with solving each column alone.
    #[test] fn a_33_by_33_system_leaves_no_residual_and_many_columns_agree() {
        let mut r = crate::shape::synthetic::Rng::new(4);
        let mut u = || (r.next() >> 11) as f64 / (1u64 << 53) as f64 - 0.5;
        let (rows, n) = (40, 33);
        let m: Vec<f64> = (0..rows * n).map(|_| u()).collect();
        let mut a = vec![0.0; n * n];
        for i in 0..n { for j in 0..n { a[i * n + j] = (0..rows).map(|k| m[k * n + i] * m[k * n + j]).sum::<f64>() + if i == j { 1.0 } else { 0.0 }; } }
        let b: Vec<f64> = (0..n * 2).map(|_| u()).collect();          // two columns, row-major n × 2
        let x = solve_spd_many(&a, n, &b, 2).unwrap();
        for c in 0..2 {
            let col: Vec<f64> = (0..n).map(|i| b[i * 2 + c]).collect();
            let one = solve_spd(&a, n, &col).unwrap();
            for i in 0..n {
                assert!((one[i] - x[i * 2 + c]).abs() < 1e-12);
                let res: f64 = (0..n).map(|j| a[i * n + j] * one[j]).sum::<f64>() - col[i];
                assert!(res.abs() < 1e-10, "row {i}: residual {res}");
            }
        }
    }
}

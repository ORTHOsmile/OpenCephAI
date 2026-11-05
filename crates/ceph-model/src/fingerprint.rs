//! Part F, owner Q9 (18 Oct): "start that model afresh" when its file changes. Which model file made each stored mark.
//! The fingerprint itself is `ceph_infer::spec::fingerprint` (the one formula); this module reads stored values and says
//! which films an earlier file ran on.
use std::collections::{BTreeMap, BTreeSet};

/// A model's mark stored before Part F (library formats up to 13; the name is from when Part F was to be format 13 and
/// is kept, chain spec §8), as the app recorded it then, and the fingerprint of the file that made it.
#[derive(Debug, PartialEq)]
pub struct Before13 { pub model_id: &'static str, pub recorded: &'static str, pub fingerprint: &'static str }

/// Before Part F the app stored, for the three converted models, the SHA-256 of the network file only (their weights
/// sit in a second file), and runs before schema 10 stored nothing. Every build that could run these four ids installed
/// exactly the files pinned in `crates/ceph-model/catalog/catalog.json`: each pin is unchanged since it was added
/// (aec8d0a, 1 Oct; Aariz f676223, 7 Oct; re-checked 26 Oct), and installing refuses any other file (`install_local`, `convert`). So such a
/// mark was made by the pinned files, whose fingerprint is given here. FROZEN: never follows a later catalogue.
pub const BEFORE_13: [Before13; 4] = [
    Before13 { model_id: "cwlachap-hrnet-w32", recorded: "57af69dbe035ddd153b33341efe4035057c590782cf2adcc3e0903c601b13db2",
        fingerprint: "03becdd8dcade448d2bdb2e61788a921dcfdacbe1a63f66adb8fce5613c8c2d1" },
    Before13 { model_id: "gu2net-isbi19", recorded: "c41e7116c098343bec27301b67fa3667be93b291bc102440202e67b7949d796b",
        fingerprint: "c21e7c7e07d3941127acf17a6f0c224f6886d584764de0ce9298e08bdd207c86" },
    Before13 { model_id: "srpose-cldet23", recorded: "61b601aa6194e1142a39e5159fd498611257d82af0c68106bc18cc983228e368",
        fingerprint: "09e6d41d36cac80eafc5af2b8d493f8e00203bd50dcb08fd24ca3fd2a8bf08ae" },
    Before13 { model_id: "aariz-cepha29", recorded: "cacd38201ada69fa7d3ea2566cb63b315302f35e3c66fb483a6eed32c88f14c5",
        fingerprint: "cacd38201ada69fa7d3ea2566cb63b315302f35e3c66fb483a6eed32c88f14c5" },
];

/// The fingerprint of the file that made a stored mark: the stored value, lower case; a value stored before Part F, or a
/// missing one, of the four models read through BEFORE_13; None when it cannot be known (missing, for any other model).
pub fn normalise(model_id: &str, recorded: Option<&str>) -> Option<String> {
    let rec = recorded.map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty());
    match (rec, BEFORE_13.iter().find(|b| b.model_id == model_id)) {
        (None, Some(b)) => Some(b.fingerprint.to_string()),
        (Some(r), Some(b)) if r == b.recorded => Some(b.fingerprint.to_string()),
        (r, _) => r,
    }
}

/// (case id, model id) for every film an installed model ran on with a file other than its current one. `current`: each
/// installed model's fingerprint now. `runs`: (case id, model id, stored model_sha256) of every stored run. A model not
/// installed is skipped: none of its marks count anyway, and there is nothing to run.
pub fn earlier_films(current: &BTreeMap<String, String>, runs: &[(String, String, Option<String>)]) -> BTreeSet<(String, String)> {
    runs.iter().filter(|(_, m, rec)| current.get(m).is_some_and(|cur| normalise(m, rec.as_deref()).as_ref() != Some(cur)))
        .map(|(c, m, _)| (c.clone(), m.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: &str = "srpose-cldet23";
    const SR_NET: &str = "61b601aa6194e1142a39e5159fd498611257d82af0c68106bc18cc983228e368";
    const SR_PINNED: &str = "09e6d41d36cac80eafc5af2b8d493f8e00203bd50dcb08fd24ca3fd2a8bf08ae";
    #[test] fn the_before_13_table_is_pinned() {
        let t: Vec<(&str, &str, &str)> = BEFORE_13.iter().map(|b| (b.model_id, &b.recorded[..8], &b.fingerprint[..8])).collect();
        assert_eq!(t, [("cwlachap-hrnet-w32", "57af69db", "03becdd8"), ("gu2net-isbi19", "c41e7116", "c21e7c7e"),
            ("srpose-cldet23", "61b601aa", "09e6d41d"), ("aariz-cepha29", "cacd3820", "cacd3820")]);
        assert!(BEFORE_13.iter().all(|b| b.recorded.len() == 64 && b.fingerprint.len() == 64));
    }
    #[test] fn an_old_or_missing_value_reads_as_the_pinned_files_and_anything_else_as_itself() {
        assert_eq!(normalise(SR, Some(SR_NET)).as_deref(), Some(SR_PINNED), "the network file's hash, stored before Part F");
        assert_eq!(normalise(SR, Some(&SR_NET.to_uppercase())).as_deref(), Some(SR_PINNED));
        assert_eq!(normalise(SR, None).as_deref(), Some(SR_PINNED), "a run before schema 10");
        assert_eq!(normalise(SR, Some("")).as_deref(), Some(SR_PINNED), "an empty value is a missing one");
        assert_eq!(normalise(SR, Some("ABCD")).as_deref(), Some("abcd"), "a new file's fingerprint stands as stored");
        assert_eq!(normalise("someone-else", None), None, "unknown for a model the table does not name");
        assert_eq!(normalise("someone-else", Some(SR_NET)).as_deref(), Some(SR_NET), "the table is per model");
    }
    #[test] fn earlier_films_are_the_films_an_installed_model_ran_on_with_another_file() {
        let current = BTreeMap::from([(SR.to_string(), "fp-new".to_string()), ("aariz-cepha29".to_string(), BEFORE_13[3].fingerprint.to_string())]);
        let run = |c: &str, m: &str, rec: Option<&str>| (c.to_string(), m.to_string(), rec.map(str::to_string));
        let runs = [run("c1", SR, Some(SR_NET)), run("c2", SR, Some("fp-new")), run("c2", SR, Some("fp-new")),
            run("c3", "aariz-cepha29", None), run("c4", "gu2net-isbi19", Some("x"))];
        assert_eq!(earlier_films(&current, &runs), BTreeSet::from([("c1".to_string(), SR.to_string())]),
            "c1: SRPose's earlier file; c2: the current file; c3: Aariz before schema 10 is its pinned file, still current; c4: GU2Net not installed");
        assert!(earlier_films(&current, &[]).is_empty());
    }
}

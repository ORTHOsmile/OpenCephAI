//! ceph-store: the CephTrace case library (plan §3.2, decision 16). One SQLite file plus content-addressed
//! images, all under the app's data folder on this Mac. Nothing here talks to the network.
pub mod schema;
pub mod identity;
pub mod filedate;
mod layouts;
mod library;
mod details;
pub mod library_ids;

pub use details::{merge_patient_id, FilmDetailsRead};
pub use library_ids::LibraryIdFound;
pub use layouts::{MachineMatch, MachineSummary, Place};
pub use library::LabelApplied;
pub use library::{verify_backup, Library, UPGRADE_BACKUPS_DIR, UPGRADE_COPY_FAILED};
pub use schema::SUPERSEDED_11;
pub use identity::{merge_reads, Conflict, IdentityIssue, IdentityOutcome, IdentityRead, PatientRef};
use serde::{Deserialize, Serialize};

/// Import formats (decision 21: no DICOM).
pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "tif", "tiff", "bmp"];
pub const SOURCES: [&str; 3] = ["ai", "ai-adjusted", "manual"];
/// Deleted cases stay restorable for this long, then `open` purges them.
pub const KEEP_DELETED_DAYS: i64 = 30;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandmarkRow {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub source: String,
    pub verified: bool,
    pub ai_x: Option<f64>,
    pub ai_y: Option<f64>,
    pub confidence: Option<f64>,
    /// The model that placed this AI point (schema 10); `None` for a hand-placed point and for cases before schema 10.
    #[serde(default)]
    pub placed_by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo { pub sha256: String, pub ext: String, pub width: u32, pub height: u32, pub original_name: String, pub path: String }

/// Everything the tracing view needs to reopen a case exactly as it was left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseDoc {
    pub id: String,
    pub patient_name: String,
    pub timepoint: String,
    pub taken_on: Option<String>,
    /// Where the film date came from: "label", "image" (the file's EXIF date), "import" (the import date), "manual", or
    /// None for cases from before schema 2.
    pub taken_on_source: Option<String>,
    /// The patient's name key (identity::name_key), for Compare with… and the Patients list.
    pub patient_key: String,
    pub date_of_birth: Option<String>,
    /// The ID printed on the film's label: kept for reference, never used for matching.
    pub scan_id: Option<String>,
    /// "film" while the name read from a labelled field is unconfirmed; "manual" once a person has typed or confirmed it,
    /// or when no name was read. ("guess" appears only in schema-2 libraries' CHECK list; schema 3 converts those rows.)
    pub identity_source: String,
    /// false while "Check patient details" is waiting for the clinician.
    pub identity_checked: bool,
    pub identity_issues: Vec<IdentityIssue>,
    /// Fields filled from the machine's learned default and not yet confirmed ("name", "dob", "scan_date", "scan_id").
    pub learned_fields: Vec<String>,
    /// The patient's gender, "F" or "M"; None = Not recorded (schema 8, spec 2026-10-04).
    pub gender: Option<String>,
    /// Who referred the patient; None = not recorded (schema 8).
    pub referring_practitioner: Option<String>,
    /// The reference population chosen for this case (spec 2026-10-06 Part C, schema 9); None = use the clinic
    /// default (`Library::default_population`).
    pub population: Option<String>,
    /// The Patient ID as printed on this X-ray, saved on the film itself (format 11; addendum D2, Q8: each X-ray
    /// keeps its own); None = blank.
    #[serde(default)] pub printed_patient_id: Option<String>,
    /// X-ray type as printed (e.g. "Lateral Ceph"), on this film (format 11); None = blank.
    #[serde(default)] pub xray_type: Option<String>,
    /// X-ray dimensions as printed (e.g. "24 x 30 cm"), on this film (format 11). Text only: never used for scale.
    #[serde(default)] pub xray_size: Option<String>,
    /// The radiography practice printed on this film (format 11); None = blank.
    #[serde(default)] pub radiography_practice: Option<String>,
    /// The library's own number for this X-ray's patient, as text ("L-00042"; owner LIBID-1, L1); None until the
    /// patient has a name (L6), except a number kept through a correction that cleared the name (rule 2).
    #[serde(default)] pub library_id: Option<String>,
    /// Every Patient ID on this patient's live X-rays (addendum D2, LIBID-1), case/space-insensitive, first spelling
    /// kept, oldest X-ray first.
    #[serde(default)] pub patient_ids_seen: Vec<String>,
    /// Other, named patients whose X-rays carry this X-ray's own Patient ID (addendum D2, LIBID-1): a link suggestion,
    /// never auto-joined. Empty while this X-ray's own Patient ID is blank.
    #[serde(default)] pub id_matches: Vec<IdMatch>,
    /// Where this patient's numbers went (owner L9-A): numbers merged into its number, and X-rays that left them.
    #[serde(default)] pub library_trail: Vec<crate::library_ids::TrailLine>,
    pub image: ImageInfo,
    pub facing: String,
    pub orientation: serde_json::Value,
    pub display: serde_json::Value,
    /// mm per image px from a ruler calibration; None = the assumed 0.1 mm (decision 21).
    pub spacing_mm: Option<f64>,
    pub verified_at: Option<String>,
    pub verified_by: Option<String>,
    pub landmarks: Vec<LandmarkRow>,
    pub created_at: String,
    pub updated_at: String,
}

/// What the tracing view writes back on autosave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseEdit {
    pub id: String,
    pub facing: String,
    pub orientation: serde_json::Value,
    pub display: serde_json::Value,
    pub landmarks: Vec<LandmarkRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseMeta {
    pub patient_name: String, pub timepoint: String, pub taken_on: Option<String>,
    #[serde(default)] pub date_of_birth: Option<String>,
    #[serde(default)] pub scan_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseSummary {
    pub id: String,
    pub patient_name: String,
    pub timepoint: String,
    pub taken_on: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub thumb_path: String,
    pub landmarks: i64,
    pub unverified: i64,
    pub verified_at: Option<String>,
    pub deleted_at: Option<String>,
    /// The saved view orientation, so a Library card shows the case as it opens (flipped and levelled).
    pub orientation: serde_json::Value,
    pub date_of_birth: Option<String>,
    pub patient_key: String,
    /// false = shown with a "Check details" chip in the Review queue.
    pub identity_checked: bool,
    /// The library's own number for this X-ray's patient (addendum D2, LIBID-1); None until the patient has a name.
    #[serde(default)] pub library_id: Option<String>,
    /// Every number ever merged into this patient's current one, so a quoted old number still finds the row
    /// (addendum D2, LIBID-2; the Library search box).
    #[serde(default)] pub former_library_ids: Vec<String>,
    /// This X-ray's own printed Patient ID (addendum D2, LIBID-1; the Library search box).
    #[serde(default)] pub printed_patient_id: Option<String>,
}

/// What a Patient ID link suggestion offers (addendum D2, LIBID-1): a different, named patient record whose X-rays
/// carry the same Patient ID as the one being viewed (case and spaces ignored), and how many of its X-rays do.
/// "Same patient" moves this X-ray only; "Not the same" hides this suggestion for this X-ray and this patient.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdMatch { pub library_id: String, pub patient: PatientRef, pub films: i64 }

/// Result of an autosave: the case's new timestamp, and whether it is still verified (any landmark change clears it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved { pub updated_at: String, pub verified_at: Option<String> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported { pub case_id: String, pub created: bool }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRun { pub model_id: String, pub execution_provider: String, pub facing: String, pub total_ms: f64,
    /// The weights' SHA-256 (schema 10); `None` from a caller that does not know it.
    #[serde(default)] pub model_sha256: Option<String> }
/// One output channel of one AI run (spec 2026-10-01 Part 3): every model's raw point, mapped to a landmark or not.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPoint { pub channel: u32, pub landmark_id: Option<String>, pub x: f64, pub y: f64, pub peak: f64 }
/// A model's newest run on a film (ghost marks).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPoints { pub model_id: String, pub ran_at: String, pub facing: String, pub points: Vec<AiPoint>,
    #[serde(default)] pub execution_provider: String, #[serde(default)] pub model_sha256: Option<String> }
/// One row of the learning record (spec 2026-10-13 "Parked" P5; owner SCHEMA10-A, Q5 second half): how far one model's
/// guess was from a point a human verified or placed. `how` is "accepted-unmoved", "moved" or "hand-placed"; `placer`
/// marks the model that placed the point; `mm_assumed` means no ruler, so 0.1 mm per px was assumed (Q10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningRow { pub landmark_id: String, pub model_id: String, pub model_sha256: Option<String>, pub execution_provider: String,
    pub dist_px: f64, pub dist_mm: f64, pub mm_assumed: bool, pub machine: String, pub how: String, pub placer: bool }

/// A clinician's own norm (spec 2026-10-06 Part C, schema 9): never in git, always labelled "user norm" in the UI.
/// Keyed on (set_name, measurement); `save_user_norm` upserts. The shape matches `packages/analyses`' `UserNorm`
/// exactly (serde camelCase), since the desktop sends these straight through without reshaping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNorm { pub set_name: String, pub measurement: String, pub mean: f64, pub sd: Option<f64>, pub source_note: String }

/// A film's ABO stage (spec 2026-09-30); None = Auto.
pub const STAGES: &[&str] = &["initial", "progress", "final", "retention"];
/// One film of a patient's series (spec 2026-09-30 Part 2), unordered: the app orders it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesFilm {
    pub id: String, pub timepoint: String, pub taken_on: Option<String>, pub taken_on_source: Option<String>,
    pub created_at: String, pub stage: Option<String>, pub in_series: bool,
    /// Joined on name alone: this film or the open one has no date of birth (the key marks it "(no DOB)").
    pub name_only: bool,
}

#[cfg(test)]
mod tests {
    use super::UserNorm;

    /// Fix round 1, Minor 4: `UserNorm`'s wire shape must be exactly `packages/analyses`' `UserNorm` — the desktop
    /// sends the store's rows straight through with no reshaping (`library.userNorms()` → `resolveNorm`'s
    /// `NormQuery.userNorms`), so a key spelled wrong or an extra/missing field would silently break that at
    /// runtime, not at compile time, on the Rust side. Checked against the exact key set and a `null` sd, not a
    /// substring: a stray extra field or a wrong rename would still pass a substring check.
    #[test] fn user_norm_serialises_with_exact_camel_case_keys_and_a_null_sd() {
        let n = UserNorm { set_name: "My clinic".into(), measurement: "sna".into(), mean: 82.0, sd: None, source_note: "my own measurements".into() };
        let v = serde_json::to_value(&n).unwrap();
        assert_eq!(v, serde_json::json!({
            "setName": "My clinic", "measurement": "sna", "mean": 82.0, "sd": null, "sourceNote": "my own measurements"
        }));
    }
}

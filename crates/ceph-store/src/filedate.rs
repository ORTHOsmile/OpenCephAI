//! The date an image file says it was taken (EXIF), used when the film's label has no scan date (owner, 29 Sep).
//! Only metadata inside the file is used: the Mac's own file dates change whenever a film is copied.

/// The EXIF "date taken" (DateTimeOriginal), else "date digitised", else the image's own "date" field, as ISO.
pub fn exif_date(bytes: &[u8]) -> Option<String> {
    let exif = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(bytes)).ok()?;   // JPEG, TIFF, PNG, WebP
    [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime].into_iter().find_map(|tag| {
        let f = exif.get_field(tag, exif::In::PRIMARY)?;
        let exif::Value::Ascii(ref v) = f.value else { return None };
        let dt = exif::DateTime::from_ascii(v.first()?).ok()?;
        let iso = format!("{:04}-{:02}-{:02}", dt.year, dt.month, dt.day);
        crate::identity::iso_date_ok(&iso).then_some(iso)
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use image::ImageEncoder;

    /// A synthetic JPEG carrying the given EXIF date fields.
    pub(crate) fn jpeg_with_exif(fields: &[(exif::Tag, &str)]) -> Vec<u8> {
        let owned: Vec<exif::Field> = fields.iter().map(|(tag, v)| exif::Field { tag: *tag, ifd_num: exif::In::PRIMARY, value: exif::Value::Ascii(vec![v.as_bytes().to_vec()]) }).collect();
        let mut w = exif::experimental::Writer::new();
        for f in &owned { w.push_field(f); }
        let mut raw = std::io::Cursor::new(Vec::new());
        w.write(&mut raw, false).unwrap();
        let img = image::GrayImage::from_fn(64, 48, |x, y| image::Luma([(x * 3 + y) as u8]));
        let mut out = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90);
        enc.set_exif_metadata(raw.into_inner()).unwrap();
        enc.write_image(img.as_raw(), 64, 48, image::ExtendedColorType::L8).unwrap();
        out
    }

    #[test] fn reads_date_taken_then_digitised_then_the_image_date() {
        use exif::Tag;
        #[allow(non_snake_case)]
        let (DateTimeOriginal, DateTimeDigitized, DateTime) = (Tag::DateTimeOriginal, Tag::DateTimeDigitized, Tag::DateTime);
        assert_eq!(exif_date(&jpeg_with_exif(&[(DateTimeOriginal, "2024:01:10 09:30:00"), (DateTime, "2026:09:01 10:00:00")])).as_deref(), Some("2024-01-10"));
        assert_eq!(exif_date(&jpeg_with_exif(&[(DateTimeDigitized, "2023:05:06 08:00:00")])).as_deref(), Some("2023-05-06"));
        assert_eq!(exif_date(&jpeg_with_exif(&[(DateTime, "2022:02:03 12:00:00")])).as_deref(), Some("2022-02-03"));
    }
    #[test] fn no_or_blank_metadata_gives_nothing() {
        assert_eq!(exif_date(&jpeg_with_exif(&[(exif::Tag::DateTimeOriginal, "0000:00:00 00:00:00")])), None);
        let mut png = Vec::new();
        image::GrayImage::new(8, 8).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        assert_eq!(exif_date(&png), None);
        assert_eq!(exif_date(b"not an image"), None);
    }
}

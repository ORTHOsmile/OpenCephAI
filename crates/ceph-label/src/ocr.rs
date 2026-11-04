//! Text recognition. On macOS this is Apple Vision (Task 7); elsewhere there is none, and the caller asks the clinician.
use crate::pick::TextLine;

#[cfg(not(target_os = "macos"))]
pub fn recognize(_img: &image::GrayImage) -> anyhow::Result<Vec<TextLine>> {
    anyhow::bail!("reading the film label needs macOS (Apple Vision)")
}

/// Apple Vision text recognition on this Mac (no network): "accurate" level, language correction off (the text is names
/// and numbers). Lines come back in reading order: the left side top to bottom, then the right. Nothing is logged.
#[cfg(target_os = "macos")]
pub fn recognize(img: &image::GrayImage) -> anyhow::Result<Vec<TextLine>> {
    use objc2::{rc::Retained, AnyThread};
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel};

    let mut png = Vec::new();
    image::DynamicImage::ImageLuma8(img.clone()).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(&png);
        let handler = VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &NSDictionary::new());
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(false);
        let as_request: Retained<VNRequest> = Retained::into_super(Retained::into_super(request.clone()));
        handler.performRequests_error(&NSArray::from_retained_slice(&[as_request]))
            .map_err(|e| anyhow::anyhow!("text recognition failed: {}", e.localizedDescription()))?;
        let mut lines: Vec<TextLine> = Vec::new();
        if let Some(results) = request.results() {
            for obs in results.iter() {
                let Some(best) = obs.topCandidates(1).firstObject() else { continue };
                let bb = unsafe { obs.boundingBox() };                          // normalised, origin bottom-left
                let text = best.string().to_string();
                let line_box = [bb.origin.x, 1.0 - (bb.origin.y + bb.size.height), bb.size.width, bb.size.height];
                // Each word's own box from Vision (UTF-16 ranges); if any is missing, even boxes for the whole line.
                let mut words = Vec::new();
                for (b, u) in crate::words::word_spans(&text) {
                    let range = objc2_foundation::NSRange::new(u.start, u.end - u.start);
                    let r = unsafe { best.boundingBoxForRange_error(range) }.ok().map(|o| unsafe { o.boundingBox() });
                    let bbox = match r {
                        Some(w) => [w.origin.x, 1.0 - (w.origin.y + w.size.height), w.size.width, w.size.height],
                        None => [f64::NAN; 4],
                    };
                    words.push(crate::words::Word { text: text[b].to_string(), bbox });
                }
                if words.iter().any(|w| w.bbox[0].is_nan()) { words = crate::words::even_words(&text, line_box); }
                lines.push(TextLine { text, confidence: best.confidence(), bbox: line_box, words });
            }
        }
        Ok(crate::pick::reading_order(lines))
    })
}

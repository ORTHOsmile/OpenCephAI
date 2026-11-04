import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
  let img = NSImage(contentsOfFile: path)!
  var r = CGRect(origin: .zero, size: img.size)
  let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil)!
  let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = true
  try! VNImageRequestHandler(cgImage: cg).perform([req])
  print("=== \(path.split(separator: "/").last!)")
  for o in req.results ?? [] { print(o.topCandidates(1).first?.string ?? "") }
}

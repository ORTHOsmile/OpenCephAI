import PDFKit
let d = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
for i in 0..<d.pageCount { print("=== PAGE \(i+1)"); print(d.page(at: i)?.string ?? "") }

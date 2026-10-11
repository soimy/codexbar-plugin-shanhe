// swift-tools-version: 6.2
import Foundation
import PackageDescription

// This harness links CodexBar's real plugin runtime, so it needs a CodexBar checkout.
// Point CODEXBAR_SOURCE at one (the directory holding CodexBar's Package.swift); the
// default is a sibling checkout next to this repository.
let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let codexBarSource: URL = ProcessInfo.processInfo.environment["CODEXBAR_SOURCE"]
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0, relativeTo: packageDirectory) }
    .map(\.standardizedFileURL)
    ?? packageDirectory.appendingPathComponent("../../CodexBar").standardizedFileURL

guard FileManager.default.fileExists(atPath: codexBarSource.appendingPathComponent("Package.swift").path) else {
    fatalError("""
    No CodexBar checkout at \(codexBarSource.path).
    Clone one and point CODEXBAR_SOURCE at it:
      git clone --depth 1 https://github.com/steipete/CodexBar /tmp/CodexBar
      CODEXBAR_SOURCE=/tmp/CodexBar tools/repro/repro.sh
    """)
}

// SwiftPM derives a path dependency's package identity from its directory name, so the
// product reference below has to follow the checkout's folder rather than CodexBar's own
// manifest name.
let codexBarIdentity = codexBarSource.lastPathComponent.lowercased()

let package = Package(
    name: "plugin-repro",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(path: codexBarSource.path),
    ],
    targets: [
        .executableTarget(
            name: "repro",
            dependencies: [.product(name: "CodexBarCore", package: codexBarIdentity)],
            path: "Sources/repro"),
    ])

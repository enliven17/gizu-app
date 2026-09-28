// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "GizuStoredSignerNative",
  platforms: [.iOS(.v18)],
  products: [.library(name: "GizuStoredSignerNative", targets: ["GizuStoredSignerNative"])],
  targets: [
    .binaryTarget(name: "GizuStoredSignerCore", path: "ios/GizuStoredSignerCore.xcframework"),
    .target(
      name: "GizuStoredSignerNative", dependencies: ["GizuStoredSignerCore"], path: "ios",
      exclude: [
        "GizuStoredSignerModule.swift", "GizuStoredSigner.podspec",
        "GizuStoredSignerCore.xcframework", "Tests",
      ]),
    .testTarget(
      name: "GizuStoredSignerNativeTests", dependencies: ["GizuStoredSignerNative"],
      path: "ios/Tests", resources: [.copy("Fixtures")]),
  ],
  swiftLanguageModes: [.v5]
)

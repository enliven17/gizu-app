Pod::Spec.new do |s|
  s.name = 'GizuStoredSigner'
  s.version = '0.1.0'
  s.summary = 'Native stored-wallet authorization and restricted testnet signing'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Gizu'
  s.homepage = 'https://gizu.io'
  s.source = { :git => '' }
  s.platforms = { :ios => '18.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.exclude_files = 'Tests/**'
  s.vendored_frameworks = 'GizuStoredSignerCore.xcframework'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

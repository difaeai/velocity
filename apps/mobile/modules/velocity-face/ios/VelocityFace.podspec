Pod::Spec.new do |s|
  s.name           = 'VelocityFace'
  s.version        = '1.0.0'
  s.summary        = 'Which way a face is pointing in one photo, for the driver face scan'
  s.description    = 'Reads the head pose off a still photo with Apple Vision. JS side: ../index.ts.'
  s.license        = 'UNLICENSED'
  s.author         = 'Berreto (Private) Limited'
  s.homepage       = 'https://velocityrides.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,swift}'
end

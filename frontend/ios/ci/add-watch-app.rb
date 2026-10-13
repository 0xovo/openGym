# Adds the Apple Watch app (ios/App/Watch) to App.xcodeproj as its own target and embeds it in the
# iPhone app (App.app/Watch), in the style of add-ui-tests.rb: the project Capacitor generated stays
# as it is in the repository, and CI runs this before every iOS build while the watch app is being
# built up. Running it twice changes nothing. Once it ships, run it once and commit the project.
#
#   ruby frontend/ios/ci/add-watch-app.rb
#
# App Store Connect needs, before a signed build: the bundle id ch.opengym.app.watchkitapp (with
# HealthKit once the workout session is in) and an App Store provisioning profile for it; the
# release script then signs App.app/Watch/OpenGymWatch.app with that profile.
require 'xcodeproj'

NAME = 'OpenGymWatch'
BUNDLE_ID = 'ch.opengym.app.watchkitapp'
DIR = 'Watch'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.targets.any? { |t| t.name == NAME }
  puts "#{NAME} is already in the project"
  exit 0
end

# A single-target watchOS app (watchOS 7 and later): a plain application built for watchOS.
watch = proj.new_target(:application, NAME, :watchos, '10.0')
group = proj.main_group.new_group(DIR, DIR)
sources = Dir.children(File.join(dir, DIR)).select { |f| f.end_with?('.swift') }.sort
watch.add_file_references(sources.map { |f| group.new_file(f) })
group.new_file('Info.plist')
entitlements = File.join(dir, DIR, "#{NAME}.entitlements")
group.new_file("#{NAME}.entitlements") if File.exist?(entitlements)

app_settings = app.build_configurations.first.build_settings
watch.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['INFOPLIST_FILE'] = "#{DIR}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{DIR}/#{NAME}.entitlements" if File.exist?(entitlements)
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['SDKROOT'] = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '10.0'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['SKIP_INSTALL'] = 'YES'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = ''
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
  s['ENABLE_PREVIEWS'] = 'NO'
end

# Built before the app, and copied into App.app/Watch, where iOS looks for the companion watch app.
app.add_dependency(watch)
embed = app.new_copy_files_build_phase('Embed Watch Content')
embed.symbol_dst_subfolder_spec = :products_directory
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
file = embed.add_file_reference(watch.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# A scheme of its own, so CI can build and run just the watch app in a watch simulator.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch)
scheme.set_launch_target(watch)
scheme.save_as(File.join(dir, 'App.xcodeproj'), NAME, true)

proj.save
puts "added #{NAME} (#{BUNDLE_ID}), embedded in App"

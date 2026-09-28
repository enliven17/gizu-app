const { withPodfileProperties, withXcodeProject } = require("expo/config-plugins");
module.exports = function withStoredSignerIos(config) {
  config = withPodfileProperties(config, (result) => {
    result.modResults["ios.deploymentTarget"] = "18.0";
    return result;
  });
  return withXcodeProject(config, (result) => {
    const configurations = result.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      if (entry && typeof entry === "object" && entry.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET) {
        entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "18.0";
      }
    }
    return result;
  });
};

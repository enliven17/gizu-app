const { platformSelect } = require("nativewind/theme");

module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: require("./src/theme/colors.json"),
      borderRadius: require("./src/theme/radii.json"),
      // Android family is registered by the expo-font plugin in app.config.ts.
      fontFamily: {
        sans: platformSelect({ ios: "Helvetica Neue", android: "HelveticaNeue", default: "System" }),
      },
      screens: { xs: "370px", tall: { raw: "(min-height: 650px)" } },
    },
  },
  plugins: [],
};

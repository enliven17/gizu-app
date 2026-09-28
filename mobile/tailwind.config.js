module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: require("./src/theme/colors.json"),
      screens: { xs: "370px", tall: { raw: "(min-height: 650px)" } },
    },
  },
  plugins: [],
};

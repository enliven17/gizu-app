module.exports = {
  preset: "jest-expo",
  resolver: "react-native-worklets/jest/resolver",
  transform: { "^.+\\.[jt]sx?$": "babel-jest", "^.+\\.mjs$": "babel-jest" },
  setupFilesAfterEnv: ["<rootDir>/tests/support/setup.ts"],
  // Full screen journeys render animated wrappers; the 5s default flakes under --runInBand load.
  testTimeout: 20000,
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?(-.*)?|@expo(nent)?/.*|@react-navigation/.*|react-native-.*|nativewind|lucide-react-native)/)",
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx,js}", "!src/**/*.d.ts"],
  coverageThreshold: { global: { statements: 80, branches: 70, functions: 80, lines: 80 } },
};

export const testExclude = [
  "**/node_modules/**",
  "tests/fixtures/**",
  "dist/**",
  "dist-electron/**",
  "release/**",
];

export const testIgnoredDirectories = [
  ".git",
  "dist",
  "dist-electron",
  "node_modules",
  "release",
];

export const testProjects = [
  {
    name: "shared",
    include: "shared/**/*.test.ts",
  },
  {
    name: "electron",
    include: "electron/**/*.test.ts",
  },
  {
    name: "renderer",
    include: "src/**/*.test.ts",
  },
  {
    name: "contracts",
    include: "tests/contracts/**/*.test.ts",
  },
  {
    name: "integration",
    include: "tests/integration/**/*.test.ts",
  },
  {
    name: "scripts",
    include: "scripts/**/*.test.mjs",
  },
];

export const testScanRoots = [...new Set(
  testProjects.map(({ include }) => include.split("/", 1)[0]),
)];

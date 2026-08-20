import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const [outputFile, ...inputFiles] = process.argv.slice(2);

if (!outputFile || inputFiles.length < 2) {
  throw new Error(
    "Usage: node scripts/merge-update-metadata.mjs <output> <input> <input...>",
  );
}

const documents = inputFiles.map((file) => ({
  file,
  value: YAML.parse(fs.readFileSync(file, "utf8")),
}));
const versions = new Set(documents.map(({ value }) => value?.version));
if (versions.size !== 1 || versions.has(undefined)) {
  throw new Error("Update metadata files must contain the same version");
}

const filesByUrl = new Map();
for (const { file, value } of documents) {
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error(`${file} does not contain update files`);
  }
  for (const entry of value.files) {
    if (!entry?.url || !entry?.sha512) {
      throw new Error(`${file} contains an incomplete update file entry`);
    }
    const existing = filesByUrl.get(entry.url);
    if (existing && existing.sha512 !== entry.sha512) {
      throw new Error(`Conflicting checksums for ${entry.url}`);
    }
    filesByUrl.set(entry.url, entry);
  }
}

const files = [...filesByUrl.values()];
const legacyFile =
  files.find(
    (entry) => entry.url.endsWith(".zip") && !entry.url.includes("arm64"),
  ) ?? files.find((entry) => entry.url.endsWith(".zip")) ?? files[0];
const releaseDates = documents
  .map(({ value }) => value.releaseDate)
  .filter((value) => typeof value === "string")
  .sort();

const merged = {
  ...documents[0].value,
  files,
  path: legacyFile.url,
  sha512: legacyFile.sha512,
  ...(releaseDates.length > 0
    ? { releaseDate: releaseDates[releaseDates.length - 1] }
    : {}),
};

fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(outputFile, YAML.stringify(merged), "utf8");
console.log(
  `merged ${inputFiles.length} update metadata files into ${outputFile}`,
);

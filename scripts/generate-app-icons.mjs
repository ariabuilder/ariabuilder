import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rasterize the Aria badge into the platform icons electron-builder consumes.
 *
 * Default source: `.github/aria-badge-light.png`
 * Override with a 1024×1024 (or larger square) PNG:
 *   node scripts/generate-app-icons.mjs path/to/icon.png
 *
 * Needs macOS `sips` and `iconutil`. Commit the files under `build/icons/`.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.join(root, ".github", "aria-badge-light.png");
const source = path.resolve(process.argv[2] ?? defaultSource);
const outDir = path.join(root, "build", "icons");

if (process.platform !== "darwin") {
  throw new Error("App icon generation needs macOS sips and iconutil");
}
if (!fs.existsSync(source)) {
  throw new Error(`Icon source missing: ${source}`);
}

fs.mkdirSync(outDir, { recursive: true });

function sipsResize(input, pixels, output) {
  execFileSync(
    "sips",
    ["-z", String(pixels), String(pixels), input, "--out", output],
    { stdio: "ignore" },
  );
}

const master = path.join(outDir, "icon.png");
sipsResize(source, 1024, master);
sipsResize(master, 128, path.join(outDir, "128x128.png"));
sipsResize(master, 256, path.join(outDir, "128x128@2x.png"));

const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "aria-iconset-"));
const named = path.join(iconset, "icon.iconset");
fs.mkdirSync(named);
const icnsSizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [pixels, filename] of icnsSizes) {
  sipsResize(master, pixels, path.join(named, filename));
}
execFileSync("iconutil", ["-c", "icns", named, "-o", path.join(outDir, "icon.icns")], {
  stdio: "ignore",
});
fs.rmSync(iconset, { recursive: true, force: true });

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Expected a PNG buffer");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pngsToIco(pngs) {
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png) => {
    const { width, height } = pngSize(png);
    const entry = { png, width, height, offset, bytes: png.length };
    offset += png.length;
    return entry;
  });
  const ico = Buffer.alloc(offset);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(entries.length, 4);
  let cursor = 6;
  for (const entry of entries) {
    ico.writeUInt8(entry.width >= 256 ? 0 : entry.width, cursor);
    ico.writeUInt8(entry.height >= 256 ? 0 : entry.height, cursor + 1);
    ico.writeUInt8(0, cursor + 2);
    ico.writeUInt8(0, cursor + 3);
    ico.writeUInt16LE(1, cursor + 4);
    ico.writeUInt16LE(32, cursor + 6);
    ico.writeUInt32LE(entry.bytes, cursor + 8);
    ico.writeUInt32LE(entry.offset, cursor + 12);
    entry.png.copy(ico, entry.offset);
    cursor += 16;
  }
  return ico;
}

const icoScratch = fs.mkdtempSync(path.join(os.tmpdir(), "aria-ico-"));
const icoPngs = [16, 32, 48, 256].map((pixels) => {
  const file = path.join(icoScratch, `${pixels}.png`);
  sipsResize(master, pixels, file);
  return fs.readFileSync(file);
});
fs.writeFileSync(path.join(outDir, "icon.ico"), pngsToIco(icoPngs));
fs.rmSync(icoScratch, { recursive: true, force: true });

console.log(`app icons: wrote ${path.relative(root, outDir)} from ${path.relative(root, source)}`);
fs.writeFileSync(
  path.join(outDir, ".generated-from"),
  `${path.relative(root, source)}\n${fs.statSync(source).mtimeMs}\n`,
  "utf8",
);

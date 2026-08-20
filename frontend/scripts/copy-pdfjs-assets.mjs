import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjsDirectory = dirname(require.resolve("pdfjs-dist/package.json"));
const outputDirectory = resolve(frontendDirectory, "public", "pdfjs");
const assetDirectories = ["wasm", "iccs", "cmaps", "standard_fonts"];
const requiredAssetFiles = [
  "wasm/openjpeg.wasm",
  "wasm/openjpeg_nowasm_fallback.js",
  "wasm/qcms_bg.wasm",
  "iccs/CGATS001Compat-v2-micro.icc",
  "cmaps/Adobe-CNS1-UCS2.bcmap",
  "standard_fonts/FoxitSerif.pfb",
];

async function verifyRequiredAssetFiles(assetRootDirectory) {
  await Promise.all(
    requiredAssetFiles.map(async (assetFile) => {
      const assetFileStats = await stat(resolve(assetRootDirectory, assetFile));
      if (!assetFileStats.isFile()) {
        throw new Error(`PDF.js asset is not a file: ${assetFile}`);
      }
    })
  );
}

try {
  await Promise.all(assetDirectories.map((assetDirectory) => stat(resolve(pdfjsDirectory, assetDirectory))));
  await verifyRequiredAssetFiles(pdfjsDirectory);
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    assetDirectories.map((assetDirectory) =>
      cp(resolve(pdfjsDirectory, assetDirectory), resolve(outputDirectory, assetDirectory), { force: true, recursive: true })
    )
  );
  await verifyRequiredAssetFiles(outputDirectory);
  console.log(`Copied PDF.js optional assets to ${outputDirectory}`);
} catch (error) {
  console.error("Could not copy required PDF.js assets.", error);
  process.exitCode = 1;
}

/* Purpose: Watches raster website images, generates missing WebPs, and nudges Hugo to rebuild. */

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const chokidar = require("chokidar");

const siteRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(siteRoot, "assets", "images");
const triggerFile = path.join(siteRoot, "data", "webp-watch-trigger.json");
const debounceMs = 350;
const validExtensions = new Set([".jpg", ".jpeg", ".png"]);

const pendingFiles = new Set();
let debounceTimer = null;
let isGenerating = false;

function isRasterSource(filePath) {
   const extension = path.extname(filePath).toLowerCase();
   if (!validExtensions.has(extension)) {
      return false;
   }

   if (filePath.includes(`${path.sep}generated${path.sep}`)) {
      return false;
   }

   return true;
}

async function touchTrigger(generatedFiles) {
   const payload = {
      updatedAt: new Date().toISOString(),
      files: generatedFiles.map((filePath) => path.relative(siteRoot, filePath)),
   };

   await fs.writeFile(triggerFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runGenerator() {
   if (isGenerating || pendingFiles.size === 0) {
      return;
   }

   isGenerating = true;
   const filesToGenerate = [...pendingFiles];
   pendingFiles.clear();

   const relativePaths = filesToGenerate.map((filePath) => path.relative(siteRoot, filePath));
   console.log(`[webp] Generating WebP derivatives for ${relativePaths.join(", ")}`);

   const child = spawn("python3", ["scripts/generate-webp.py", ...relativePaths], {
      cwd: siteRoot,
      stdio: ["ignore", "inherit", "inherit"],
   });

   child.on("exit", async (code) => {
      isGenerating = false;

      if (code === 0) {
         try {
            await touchTrigger(filesToGenerate);
            console.log("[webp] Generated WebP derivatives and triggered Hugo rebuild");
         } catch (error) {
            console.error(`[webp] Failed to update rebuild trigger: ${error.message}`);
         }
      } else {
         console.error(`[webp] WebP generation failed with exit code ${code}`);
      }

      if (pendingFiles.size > 0) {
         runGenerator();
      }
   });
}

function scheduleGeneration(filePath) {
   if (!isRasterSource(filePath)) {
      return;
   }

   pendingFiles.add(path.resolve(filePath));
   clearTimeout(debounceTimer);
   debounceTimer = setTimeout(runGenerator, debounceMs);
}

const watcher = chokidar.watch(assetsRoot, {
   ignoreInitial: true,
   awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
   },
});

watcher
   .on("add", scheduleGeneration)
   .on("change", scheduleGeneration)
   .on("ready", () => {
      console.log("[webp] Watching raster assets for WebP regeneration");
   })
   .on("error", (error) => {
      console.error(`[webp] Watcher error: ${error.message}`);
   });

function shutdown() {
   clearTimeout(debounceTimer);
   watcher.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

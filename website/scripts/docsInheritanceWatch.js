/* Purpose: Watches docs inputs and refreshes generated inheritance route anchors. */

const path = require("path");
const { spawn } = require("child_process");

const chokidar = require("chokidar");

const siteRoot = path.resolve(__dirname, "..");
const watchedPaths = [
   path.join(siteRoot, "content", "docs"),
   path.join(siteRoot, "data", "docs-nav"),
   path.join(siteRoot, "data", "docs-versions.toml"),
];
const debounceMs = 350;

let debounceTimer = null;
let isMaterializing = false;
let shouldMaterializeAgain = false;

function materializeRoutes() {
   if (isMaterializing) {
      shouldMaterializeAgain = true;
      return;
   }

   isMaterializing = true;
   shouldMaterializeAgain = false;
   console.log("[docs] Refreshing inherited documentation routes");

   const child = spawn("python3", ["scripts/materialize-inherited-docs.py"], {
      cwd: siteRoot,
      stdio: ["ignore", "inherit", "inherit"],
   });

   child.on("error", (error) => {
      console.error(`[docs] Route refresh failed: ${error.message}`);
   });

   child.on("exit", (code) => {
      isMaterializing = false;

      if (code === 0) {
         console.log("[docs] Inherited documentation routes refreshed");
      } else {
         console.error(`[docs] Route refresh failed with exit code ${code}`);
      }

      if (shouldMaterializeAgain) {
         materializeRoutes();
      }
   });
}

function scheduleMaterialization() {
   clearTimeout(debounceTimer);
   debounceTimer = setTimeout(materializeRoutes, debounceMs);
}

const watcher = chokidar.watch(watchedPaths, {
   ignoreInitial: true,
   awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
   },
});

watcher
   .on("add", scheduleMaterialization)
   .on("change", scheduleMaterialization)
   .on("unlink", scheduleMaterialization)
   .on("ready", () => {
      console.log("[docs] Watching docs inputs for inherited route refreshes");
   })
   .on("error", (error) => {
      console.error(`[docs] Watcher error: ${error.message}`);
   });

function shutdown() {
   clearTimeout(debounceTimer);
   watcher.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* Purpose: Watches docs inputs and refreshes generated inheritance route anchors. */

const path = require("path");
const fs = require("fs/promises");
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
const changedMarkdownPaths = new Set();
const ignoredChangePaths = new Set();

async function refreshChangedMarkdownPages() {
   const refreshedPaths = [...changedMarkdownPaths];
   changedMarkdownPaths.clear();

   for (const filePath of refreshedPaths) {
      try {
         await fs.access(filePath);
         ignoredChangePaths.add(filePath);
         const now = new Date();
         await fs.utimes(filePath, now, now);
      } catch (error) {
         if (error.code !== "ENOENT") {
            console.error(`[docs] Could not refresh ${filePath}: ${error.message}`);
         }
      }
   }
}

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

   child.on("exit", async (code) => {
      isMaterializing = false;

      if (code === 0) {
         console.log("[docs] Inherited documentation routes refreshed");
         await refreshChangedMarkdownPages();
      } else {
         console.error(`[docs] Route refresh failed with exit code ${code}`);
      }

      if (shouldMaterializeAgain) {
         materializeRoutes();
      }
   });
}

function scheduleMaterialization(event, filePath) {
   const absolutePath = path.resolve(filePath);
   if (event === "change" && ignoredChangePaths.delete(absolutePath)) {
      return;
   }

   if ((event === "add" || event === "change") && absolutePath.endsWith(".md")) {
      changedMarkdownPaths.add(absolutePath);
   }

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
   .on("add", (filePath) => scheduleMaterialization("add", filePath))
   .on("change", (filePath) => scheduleMaterialization("change", filePath))
   .on("unlink", (filePath) => scheduleMaterialization("unlink", filePath))
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

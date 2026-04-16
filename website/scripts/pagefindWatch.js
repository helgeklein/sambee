const { spawn } = require("child_process");
const path = require("path");

const chokidar = require("chokidar");

const siteRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(siteRoot, "public");
const debounceMs = 500;

let debounceTimer = null;
let isIndexing = false;
let shouldReindex = false;

function runPagefind() {
   if (isIndexing) {
      shouldReindex = true;
      return;
   }

   isIndexing = true;
   shouldReindex = false;

   const child = spawn("npx", ["pagefind", "--site", "public", "--quiet"], {
      cwd: siteRoot,
      stdio: ["ignore", "inherit", "inherit"],
   });

   child.on("exit", (code) => {
      isIndexing = false;

      if (code === 0) {
         console.log("[pagefind] Search index refreshed");
      } else {
         console.error(`[pagefind] Index refresh failed with exit code ${code}`);
      }

      if (shouldReindex) {
         scheduleIndex();
      }
   });
}

function scheduleIndex() {
   clearTimeout(debounceTimer);
   debounceTimer = setTimeout(runPagefind, debounceMs);
}

function handlePublicHtmlEvent(filePath) {
   if (path.extname(filePath) !== ".html") {
      return;
   }

   scheduleIndex();
}

const watcher = chokidar.watch(publicRoot, {
   ignoreInitial: true,
   ignored: (filePath) => filePath.includes(`${path.sep}pagefind${path.sep}`),
});

watcher
   .on("add", handlePublicHtmlEvent)
   .on("change", handlePublicHtmlEvent)
   .on("unlink", handlePublicHtmlEvent)
   .on("ready", () => {
      console.log("[pagefind] Watching generated HTML for search index updates");
   })
   .on("error", (error) => {
      console.error(`[pagefind] Watcher error: ${error.message}`);
   });

function shutdown() {
   clearTimeout(debounceTimer);
   watcher.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

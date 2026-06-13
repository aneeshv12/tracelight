#!/usr/bin/env node
/**
 * tracelight CLI entry point.
 *
 * Usage:
 *   npx .              — start server on a free port and open the browser
 *   npx . --port 3456  — use a specific port
 *   npx . --no-open    — start server without opening the browser
 *
 * Plain argv parsing — no commander needed for this trivial interface.
 */

import { createServer } from "./server/index.js";
import { createServer as createNetServer } from "net";

function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(startPort, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : startPort;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      // Port in use — try the next one
      findFreePort(startPort + 1).then(resolve).catch(reject);
    });
  });
}

function parseArgs(argv: string[]): { port: number | null; openBrowser: boolean } {
  let port: number | null = null;
  let openBrowser = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && i + 1 < argv.length) {
      const parsedPort = parseInt(argv[i + 1], 10);
      if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
        port = parsedPort;
      }
      i++;
    } else if (arg === "--no-open") {
      openBrowser = false;
    }
  }

  return { port, openBrowser };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const port = args.port ?? (await findFreePort(7823));

  console.log(`tracelight starting on port ${port}...`);

  const server = await createServer({ port });
  const url = await server.start();

  console.log(`tracelight running at ${url}`);

  if (args.openBrowser) {
    // Dynamic import so the module loads only when needed
    const { default: open } = await import("open");
    await open(url);
  }

  // Keep the process running; Ctrl+C will stop it
  process.on("SIGINT", async () => {
    console.log("\nStopping tracelight...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("tracelight failed to start:", error);
  process.exit(1);
});

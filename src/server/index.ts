/**
 * Fastify HTTP server for tracelight.
 *
 * Serves:
 *   - GET /api/projects    — list of all projects with session summaries
 *   - GET /api/sessions/:id — full session detail by sessionId
 *   - Static files from the Vite build output (ui/dist/)
 *
 * The server imports only from model.ts and apiTypes.ts — never from parser/.
 */

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { loadAllProjects, loadSession, toSessionDetail } from "../projectLoader.js";
import type { ProjectListing, SessionDetail } from "../apiTypes.js";

// Resolve the path to the built UI — works whether running from src or dist
const __dirname = fileURLToPath(new URL(".", import.meta.url));
// When compiled, this file is at dist/server/index.js; ui/dist is at ../../ui/dist
// When running via tsx src/server/index.ts: ui/dist is at ../ui/dist
const UI_DIST_CANDIDATES = [
  join(__dirname, "../../ui/dist"),
  join(__dirname, "../ui/dist"),
  join(process.cwd(), "ui/dist"),
];

function findUiDist(): string | null {
  for (const candidate of UI_DIST_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface ServerOptions {
  port: number;
}

export async function createServer(options: ServerOptions): Promise<{
  start: () => Promise<string>;
  stop: () => Promise<void>;
}> {
  const fastify = Fastify({ logger: false });

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------

  fastify.get("/api/projects", async (_request, reply) => {
    const projects: ProjectListing[] = loadAllProjects();
    reply.type("application/json");
    return projects;
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const sessionId = request.params.id;

      // Find the session across all projects
      const projects = loadAllProjects();
      for (const project of projects) {
        for (const sessionItem of project.sessions) {
          if (sessionItem.sessionId === sessionId) {
            // Re-parse the full session for detail
            const summary = loadSession(sessionItem.filePath);
            if (summary === null) {
              reply.code(500).send({ error: "Failed to load session" });
              return;
            }
            const detail: SessionDetail = toSessionDetail(summary, sessionItem.filePath);
            return detail;
          }
        }
      }

      reply.code(404).send({ error: "Session not found", sessionId });
    }
  );

  // ---------------------------------------------------------------------------
  // Static UI serving
  // ---------------------------------------------------------------------------

  const uiDist = findUiDist();
  if (uiDist) {
    await fastify.register(fastifyStatic, {
      root: uiDist,
      prefix: "/",
      // Serve index.html for all unmatched routes (SPA fallback)
      index: "index.html",
    });

    // SPA fallback: any non-API route serves index.html
    fastify.setNotFoundHandler((_request, reply) => {
      reply.sendFile("index.html");
    });
  } else {
    // No UI build: return a helpful message from root
    fastify.get("/", async (_request, reply) => {
      reply.type("text/html");
      return `<!DOCTYPE html><html><body>
        <h2>tracelight API server</h2>
        <p>UI not built yet. Run <code>npm run build:ui</code> first.</p>
        <p>API endpoints: <a href="/api/projects">/api/projects</a></p>
      </body></html>`;
    });
  }

  return {
    start: async () => {
      await fastify.listen({ port: options.port, host: "127.0.0.1" });
      return `http://127.0.0.1:${options.port}`;
    },
    stop: async () => {
      await fastify.close();
    },
  };
}

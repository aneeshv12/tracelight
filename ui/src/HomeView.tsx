import React, { useEffect, useState } from "react";
import type { ProjectListing, SessionListItem } from "@shared/apiTypes";
import { formatDate, formatDuration, formatTokens, sumTokenUsage } from "./format";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchProjects(): Promise<ProjectListing[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ProjectListing[]>;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Chip({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${
        muted
          ? "bg-gray-800 text-gray-500"
          : "bg-gray-800 text-gray-300"
      }`}
    >
      <span className="text-gray-500">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function SessionRow({
  session,
  onSelectSession,
}: {
  session: SessionListItem;
  onSelectSession: (sessionId: string) => void;
}): React.ReactElement {
  const title = session.aiTitle ?? session.sessionId.slice(0, 8) + "…";
  const tokens = sumTokenUsage(session.totalUsage);

  return (
    <button
      onClick={() => onSelectSession(session.sessionId)}
      className="w-full text-left flex flex-col gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-700 hover:bg-gray-850 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-white font-medium leading-snug truncate">
          {title}
        </span>
        <span className="text-xs text-gray-500 shrink-0 pt-0.5">
          {formatDate(session.startedAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip label="turns" value={String(session.turnCount)} />
        <Chip label="dur" value={formatDuration(session.durationMs)} />
        <Chip label="tokens" value={formatTokens(tokens)} />
        {session.modelsUsed.length > 0 && (
          <Chip
            label="model"
            value={session.modelsUsed[0].replace(/^claude-/, "")}
          />
        )}
        {session.unknownEventCount > 0 && (
          <Chip
            label="unknown"
            value={String(session.unknownEventCount)}
            muted
          />
        )}
      </div>
    </button>
  );
}

function ProjectSection({
  project,
  onSelectSession,
}: {
  project: ProjectListing;
  onSelectSession: (sessionId: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true);

  return (
    <section>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 mb-3 text-left group"
      >
        <span className="text-xs text-gray-400 font-mono select-none">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">
          {project.displayName}
        </span>
        <span className="text-xs text-gray-600 font-mono">
          {project.slug}
        </span>
        <span className="ml-auto text-xs text-gray-500">
          {project.sessions.length} session{project.sessions.length !== 1 ? "s" : ""}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 ml-5">
          {project.sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              onSelectSession={onSelectSession}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main HomeView
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: ProjectListing[] };

export function HomeView({
  onSelectSession,
}: {
  onSelectSession: (sessionId: string) => void;
}): React.ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    fetchProjects()
      .then((projects) => setLoadState({ status: "loaded", projects }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setLoadState({ status: "error", message });
      });
  }, []);

  if (loadState.status === "loading") {
    return (
      <div className="text-gray-400 text-sm animate-pulse">
        Loading sessions from ~/.claude/projects/…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
        <strong>Failed to load projects:</strong> {loadState.message}
      </div>
    );
  }

  const { projects } = loadState;

  if (projects.length === 0) {
    return (
      <div className="text-gray-400 text-sm">
        No Claude Code projects found in ~/.claude/projects/.
      </div>
    );
  }

  const totalSessions = projects.reduce((sum, p) => sum + p.sessions.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-xs text-gray-500">
        {projects.length} project{projects.length !== 1 ? "s" : ""} · {totalSessions} session{totalSessions !== 1 ? "s" : ""}
      </div>
      {projects.map((project) => (
        <ProjectSection
          key={project.slug}
          project={project}
          onSelectSession={onSelectSession}
        />
      ))}
    </div>
  );
}

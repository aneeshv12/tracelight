import React, { useState } from "react";
import { diffLines } from "diff";
import type { DiffData, EditDiffData, MultiEditDiffData, WriteDiffData } from "./diffInput";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Max number of changed lines to show before offering an expand toggle.
 * Unchanged context lines don't count toward this limit.
 */
const COLLAPSED_CHANGED_LINE_LIMIT = 40;

// ---------------------------------------------------------------------------
// Low-level line rendering
// ---------------------------------------------------------------------------

interface DiffLine {
  kind: "added" | "removed" | "unchanged";
  text: string;
}

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const parts = diffLines(oldText, newText);
  const lines: DiffLine[] = [];

  for (const part of parts) {
    const rawLines = part.value.split("\n");
    // diffLines includes a trailing empty string when the part ends with \n
    const textLines =
      rawLines.length > 1 && rawLines[rawLines.length - 1] === ""
        ? rawLines.slice(0, -1)
        : rawLines;

    const kind: DiffLine["kind"] = part.added
      ? "added"
      : part.removed
      ? "removed"
      : "unchanged";

    for (const text of textLines) {
      lines.push({ kind, text });
    }
  }

  return lines;
}

function DiffLineRow({ line }: { line: DiffLine }): React.ReactElement {
  const gutterChar = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";

  const colorClasses =
    line.kind === "added"
      ? "bg-green-950 text-green-300"
      : line.kind === "removed"
      ? "bg-red-950 text-red-300"
      : "bg-transparent text-gray-500";

  const gutterColorClass =
    line.kind === "added"
      ? "text-green-600"
      : line.kind === "removed"
      ? "text-red-600"
      : "text-gray-700";

  return (
    <div className={`flex min-w-0 ${colorClasses}`}>
      <span
        className={`select-none w-5 shrink-0 text-center font-mono text-xs leading-5 ${gutterColorClass}`}
      >
        {gutterChar}
      </span>
      <span className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto flex-1 min-w-0">
        {line.text}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single diff section (one old/new pair)
// ---------------------------------------------------------------------------

interface SingleDiffSectionProps {
  oldText: string;
  newText: string;
}

function SingleDiffSection({ oldText, newText }: SingleDiffSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const allLines = computeDiffLines(oldText, newText);

  const changedLineCount = allLines.filter(
    (line) => line.kind === "added" || line.kind === "removed"
  ).length;

  const shouldCollapse = changedLineCount > COLLAPSED_CHANGED_LINE_LIMIT && !expanded;

  let displayedLines = allLines;
  if (shouldCollapse) {
    let changedSeen = 0;
    const truncatedLines: DiffLine[] = [];
    for (const line of allLines) {
      if (line.kind !== "unchanged") {
        changedSeen++;
      }
      truncatedLines.push(line);
      if (changedSeen >= COLLAPSED_CHANGED_LINE_LIMIT) {
        break;
      }
    }
    displayedLines = truncatedLines;
  }

  if (allLines.length === 0) {
    return (
      <div className="text-xs text-gray-600 font-mono px-2 py-1">
        (no changes)
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        {displayedLines.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
      {shouldCollapse && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-gray-800">
          <span className="text-xs text-gray-600 font-mono">
            …{changedLineCount - COLLAPSED_CHANGED_LINE_LIMIT} more changed lines
          </span>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
          >
            expand ▾
          </button>
        </div>
      )}
      {expanded && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-gray-800">
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
          >
            collapse ▴
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-added section (for Write tool)
// ---------------------------------------------------------------------------

function AllAddedSection({ content }: { content: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const rawLines = content.split("\n");
  // Drop trailing empty string from trailing newline
  const allLines: DiffLine[] =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === ""
      ? rawLines.slice(0, -1).map((text) => ({ kind: "added" as const, text }))
      : rawLines.map((text) => ({ kind: "added" as const, text }));

  const shouldCollapse = allLines.length > COLLAPSED_CHANGED_LINE_LIMIT && !expanded;
  const displayedLines = shouldCollapse
    ? allLines.slice(0, COLLAPSED_CHANGED_LINE_LIMIT)
    : allLines;

  if (allLines.length === 0) {
    return (
      <div className="text-xs text-gray-600 font-mono px-2 py-1">
        (empty file)
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        {displayedLines.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
      {shouldCollapse && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-gray-800">
          <span className="text-xs text-gray-600 font-mono">
            …{allLines.length - COLLAPSED_CHANGED_LINE_LIMIT} more lines
          </span>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
          >
            expand ▾
          </button>
        </div>
      )}
      {expanded && (
        <div className="flex items-center gap-2 px-2 py-1 border-t border-gray-800">
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
          >
            collapse ▴
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File path header
// ---------------------------------------------------------------------------

function FilePathHeader({ filePath }: { filePath: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800 border-b border-gray-700">
      <span className="font-mono text-xs text-gray-400">{filePath}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-shape renderers
// ---------------------------------------------------------------------------

function EditDiffRenderer({ data }: { data: EditDiffData }): React.ReactElement {
  return (
    <div className="rounded border border-gray-700 bg-gray-950 overflow-hidden">
      <FilePathHeader filePath={data.filePath} />
      {data.replaceAll && (
        <div className="px-2 py-0.5 bg-gray-800 border-b border-gray-700">
          <span className="font-mono text-xs text-amber-500">replace_all</span>
        </div>
      )}
      <SingleDiffSection oldText={data.oldString} newText={data.newString} />
    </div>
  );
}

function MultiEditDiffRenderer({ data }: { data: MultiEditDiffData }): React.ReactElement {
  return (
    <div className="rounded border border-gray-700 bg-gray-950 overflow-hidden">
      <FilePathHeader filePath={data.filePath} />
      {data.edits.map((edit, index) => (
        <div key={index}>
          {index > 0 && (
            <div className="border-t border-gray-800 mx-2 my-0.5 border-dashed" />
          )}
          <SingleDiffSection oldText={edit.oldString} newText={edit.newString} />
        </div>
      ))}
    </div>
  );
}

function WriteDiffRenderer({ data }: { data: WriteDiffData }): React.ReactElement {
  return (
    <div className="rounded border border-gray-700 bg-gray-950 overflow-hidden">
      <FilePathHeader filePath={data.filePath} />
      <div className="px-2 py-0.5 bg-gray-800 border-b border-gray-700">
        <span className="font-mono text-xs text-green-500">new file</span>
      </div>
      <AllAddedSection content={data.content} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public DiffView component
// ---------------------------------------------------------------------------

/**
 * Renders a colored line diff for a file-editing tool call.
 * The caller is responsible for passing valid DiffData (use extractDiffData).
 */
export function DiffView({ data }: { data: DiffData }): React.ReactElement {
  if (data.kind === "Edit") {
    return <EditDiffRenderer data={data} />;
  }
  if (data.kind === "MultiEdit") {
    return <MultiEditDiffRenderer data={data} />;
  }
  // data.kind === "Write"
  return <WriteDiffRenderer data={data} />;
}

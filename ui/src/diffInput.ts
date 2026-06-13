/**
 * Pure helpers for extracting diff-renderable data from file-editing tool calls.
 *
 * All functions are defensive: they return null rather than throwing when the
 * input shape is unexpected, because tool call inputs come from real transcripts
 * and may not match the expected schema.
 */

// ---------------------------------------------------------------------------
// Discriminated result types
// ---------------------------------------------------------------------------

export interface EditDiffData {
  kind: "Edit";
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

export interface MultiEditDiffData {
  kind: "MultiEdit";
  filePath: string;
  edits: Array<{ oldString: string; newString: string }>;
}

export interface WriteDiffData {
  kind: "Write";
  filePath: string;
  content: string;
}

export type DiffData = EditDiffData | MultiEditDiffData | WriteDiffData;

// ---------------------------------------------------------------------------
// Narrow-typed guard helpers
// ---------------------------------------------------------------------------

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayOfRecords(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

// ---------------------------------------------------------------------------
// Per-tool extractors
// ---------------------------------------------------------------------------

function extractEditDiff(input: Record<string, unknown>): EditDiffData | null {
  const { file_path, old_string, new_string, replace_all } = input;
  if (!isString(file_path) || !isString(old_string) || !isString(new_string)) {
    return null;
  }
  return {
    kind: "Edit",
    filePath: file_path,
    oldString: old_string,
    newString: new_string,
    replaceAll: replace_all === true,
  };
}

function extractMultiEditDiff(input: Record<string, unknown>): MultiEditDiffData | null {
  const { file_path, edits } = input;
  if (!isString(file_path) || !isArrayOfRecords(edits)) {
    return null;
  }
  const parsedEdits: Array<{ oldString: string; newString: string }> = [];
  for (const edit of edits) {
    const { old_string, new_string } = edit;
    if (!isString(old_string) || !isString(new_string)) {
      return null;
    }
    parsedEdits.push({ oldString: old_string, newString: new_string });
  }
  return {
    kind: "MultiEdit",
    filePath: file_path,
    edits: parsedEdits,
  };
}

function extractWriteDiff(input: Record<string, unknown>): WriteDiffData | null {
  const { file_path, content } = input;
  if (!isString(file_path) || !isString(content)) {
    return null;
  }
  return {
    kind: "Write",
    filePath: file_path,
    content,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Given a tool name and its input record, returns structured diff data if the
 * tool is a file-editing tool and the input matches the expected shape.
 * Returns null for non-edit tools or when the input shape is unexpected.
 */
export function extractDiffData(
  toolName: string,
  input: Record<string, unknown>
): DiffData | null {
  if (!EDIT_TOOL_NAMES.has(toolName)) {
    return null;
  }

  switch (toolName) {
    case "Edit":
      return extractEditDiff(input);
    case "MultiEdit":
      return extractMultiEditDiff(input);
    case "Write":
      return extractWriteDiff(input);
    case "NotebookEdit":
      // NotebookEdit shape is undocumented — fall through to null (raw JSON fallback).
      return null;
    default:
      return null;
  }
}

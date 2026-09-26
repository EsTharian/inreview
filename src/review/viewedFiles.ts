import { createHash } from "node:crypto";

import type { ReviewRecord, ViewedFileMark } from "../domain/comments";
import { DomainError } from "../domain/errors";
import type { FileManifestEntry, Snapshot } from "../domain/review";

/**
 * How one file of a review reads to the human reviewer: viewed at its current
 * content, viewed at content a refresh has since changed, or not viewed.
 */
export type ViewedState = "viewed" | "changed" | "unviewed";

export interface ViewedProgress {
  readonly viewed: number;
  readonly changed: number;
  readonly total: number;
}

/** The repository-relative path a viewed mark is keyed by. */
export function viewedFilePath(file: FileManifestEntry): string {
  const filePath = file.currentPath ?? file.originalPath;
  if (filePath === null) {
    throw new DomainError("INVARIANT_VIOLATION", "A file must have at least one path.");
  }
  return filePath;
}

/**
 * Identifies what the reviewer saw of a file: its new-side content and the
 * status, kind and paths that decide how that content is shown. A side that
 * stores no content (a non-regular file) is identified by its patch instead.
 */
export function viewedFileFingerprint(file: FileManifestEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        status: file.status,
        kind: file.kind,
        originalPath: file.originalPath,
        currentPath: file.currentPath,
        newSide: file.modifiedContent?.sha256 ?? null,
        patch: file.modifiedContent === null ? (file.patch?.sha256 ?? null) : null,
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * The viewed state of every file in the snapshot's combined view, keyed by
 * path. Viewed marks are per review, not per change: a per-change entry reads
 * the state of its path here, and a path absent from the combined view (no
 * net change across the review) has no state.
 */
export function viewedStates(
  record: ReviewRecord,
  snapshot: Snapshot,
): ReadonlyMap<string, ViewedState> {
  const marks = new Map(
    record.viewedFiles.map(({ path, fingerprint }) => [path, fingerprint]),
  );
  const states = new Map<string, ViewedState>();
  for (const file of combinedFiles(snapshot)) {
    const filePath = viewedFilePath(file);
    const fingerprint = marks.get(filePath);
    states.set(
      filePath,
      fingerprint === undefined
        ? "unviewed"
        : fingerprint === viewedFileFingerprint(file)
          ? "viewed"
          : "changed",
    );
  }
  return states;
}

export function viewedProgress(
  states: ReadonlyMap<string, ViewedState>,
): ViewedProgress {
  let viewed = 0;
  let changed = 0;
  for (const state of states.values()) {
    if (state === "viewed") {
      viewed += 1;
    } else if (state === "changed") {
      changed += 1;
    }
  }
  return { viewed, changed, total: states.size };
}

/**
 * The review's viewed marks after marking or unmarking one path, or undefined
 * when the path already reads that way. Marking records the fingerprint of the
 * path's entry in the snapshot's combined view.
 */
export function nextViewedMarks(
  record: ReviewRecord,
  snapshot: Snapshot,
  filePath: string,
  viewed: boolean,
  timestamp: string,
): readonly ViewedFileMark[] | undefined {
  const existing = record.viewedFiles.find(({ path }) => path === filePath);
  const others = record.viewedFiles.filter(({ path }) => path !== filePath);
  if (!viewed) {
    return existing === undefined ? undefined : others;
  }
  const file = combinedFiles(snapshot).find(
    (candidate) => viewedFilePath(candidate) === filePath,
  );
  if (file === undefined) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      "Only a file in the review's combined diff can be marked as viewed.",
    );
  }
  const fingerprint = viewedFileFingerprint(file);
  if (existing?.fingerprint === fingerprint) {
    return undefined;
  }
  return [...others, { path: filePath, fingerprint, viewedAt: timestamp }].sort(
    (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  );
}

function combinedFiles(snapshot: Snapshot): readonly FileManifestEntry[] {
  return (
    snapshot.views.find(({ identity }) => identity.mode === "combined")?.files ??
    []
  );
}

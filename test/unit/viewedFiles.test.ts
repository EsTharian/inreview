import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseReviewRecord,
  type ReviewRecord,
  type ViewedFileMark,
} from "../../src/domain/comments";
import type {
  BlobReference,
  FileManifestEntry,
  Snapshot,
} from "../../src/domain/review";
import {
  nextViewedMarks,
  viewedFileFingerprint,
  viewedProgress,
  viewedStates,
} from "../../src/review/viewedFiles";
import { makeReviewRecord } from "./storageFixtures";

const repository = "a".repeat(64);
const markedAt = "2026-01-02T00:00:00.000Z";

describe("viewed file fingerprints", () => {
  it("follow the reviewed new side, not the old side", () => {
    const file = textFile("src/a.ts", "new a");

    expect(
      viewedFileFingerprint({ ...file, originalContent: blob("another base") }),
    ).toBe(viewedFileFingerprint(file));
    expect(viewedFileFingerprint(textFile("src/a.ts", "newer a"))).not.toBe(
      viewedFileFingerprint(file),
    );
    expect(
      viewedFileFingerprint({
        ...file,
        status: "renamed",
        originalPath: "src/old-a.ts",
      }),
    ).not.toBe(viewedFileFingerprint(file));
  });

  it("identify a side without stored content by its patch", () => {
    const nonRegular: FileManifestEntry = {
      ...textFile("vendor/module", "unused"),
      kind: "non-regular",
      originalContent: null,
      modifiedContent: null,
      hunks: [],
      patch: blob("Subproject commit 1"),
    };

    expect(
      viewedFileFingerprint({ ...nonRegular, patch: blob("Subproject commit 2") }),
    ).not.toBe(viewedFileFingerprint(nonRegular));
  });
});

describe("viewed states and progress", () => {
  it("reads viewed, changed since viewed, and not viewed files and counts them", () => {
    const a = textFile("a.txt", "a1");
    const b = textFile("b.txt", "b1");
    const c = textFile("c.txt", "c1");
    const record = recordWith([a, b, c], [
      { path: "a.txt", fingerprint: viewedFileFingerprint(a), viewedAt: markedAt },
      {
        path: "b.txt",
        fingerprint: viewedFileFingerprint(textFile("b.txt", "b0")),
        viewedAt: markedAt,
      },
      {
        path: "gone.txt",
        fingerprint: viewedFileFingerprint(textFile("gone.txt", "g")),
        viewedAt: markedAt,
      },
    ]);
    const states = viewedStates(record, snapshotOf(record));

    expect([...states]).toEqual([
      ["a.txt", "viewed"],
      ["b.txt", "changed"],
      ["c.txt", "unviewed"],
    ]);
    expect(viewedProgress(states)).toEqual({ viewed: 1, changed: 1, total: 3 });
  });

  it("gives a path outside the combined view no state", () => {
    const record = recordWith([textFile("a.txt", "a1")], []);

    expect(viewedStates(record, snapshotOf(record)).has("file.txt")).toBe(false);
  });
});

describe("viewed marks", () => {
  it("marks, re-marks a changed file, and unmarks by path, sorted and without no-op writes", () => {
    const a = textFile("a.txt", "a1");
    const b = textFile("b.txt", "b1");
    const stale = {
      path: "b.txt",
      fingerprint: viewedFileFingerprint(textFile("b.txt", "b0")),
      viewedAt: markedAt,
    };
    const record = recordWith([a, b], [stale]);
    const snapshot = snapshotOf(record);

    const marked = nextViewedMarks(record, snapshot, "a.txt", true, markedAt);
    expect(marked?.map(({ path }) => path)).toEqual(["a.txt", "b.txt"]);

    const remarked = nextViewedMarks(record, snapshot, "b.txt", true, markedAt);
    expect(remarked).toEqual([
      { path: "b.txt", fingerprint: viewedFileFingerprint(b), viewedAt: markedAt },
    ]);

    const current = recordWith([a, b], remarked ?? []);
    expect(
      nextViewedMarks(current, snapshotOf(current), "b.txt", true, markedAt),
    ).toBeUndefined();
    expect(
      nextViewedMarks(current, snapshotOf(current), "a.txt", false, markedAt),
    ).toBeUndefined();
    expect(
      nextViewedMarks(current, snapshotOf(current), "b.txt", false, markedAt),
    ).toEqual([]);
    expect(() =>
      nextViewedMarks(current, snapshotOf(current), "file.txt", true, markedAt),
    ).toThrow("combined diff");
  });

  it("allows one mark per path in a stored review", () => {
    const a = textFile("a.txt", "a1");
    const mark = {
      path: "a.txt",
      fingerprint: viewedFileFingerprint(a),
      viewedAt: markedAt,
    };

    expect(() => recordWith([a], [mark, mark])).toThrow("one viewed mark per file path");
  });
});

function blob(content: string): BlobReference {
  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    byteLength: Buffer.byteLength(content),
    encoding: "gzip",
  };
}

function textFile(filePath: string, content: string): FileManifestEntry {
  return {
    fileId: `file:${filePath}`,
    status: "modified",
    kind: "text",
    originalPath: filePath,
    currentPath: filePath,
    originalContent: blob(`base of ${filePath}`),
    modifiedContent: blob(content),
    patch: blob(`patch of ${filePath}`),
    hunks: [],
    addedLines: 1,
    deletedLines: 1,
  };
}

/** The fixture review with its combined view replaced by `files`. */
function recordWith(
  files: readonly FileManifestEntry[],
  viewedFiles: readonly ViewedFileMark[],
): ReviewRecord {
  const base = makeReviewRecord(repository);
  const snapshot = snapshotOf(base);
  return parseReviewRecord({
    ...base,
    snapshots: [
      {
        ...snapshot,
        views: snapshot.views.map((view) =>
          view.identity.mode === "combined" ? { ...view, files: [...files] } : view,
        ),
      },
    ],
    viewedFiles: [...viewedFiles],
  });
}

function snapshotOf(record: ReviewRecord): Snapshot {
  const snapshot = record.snapshots.find(
    ({ id }) => id === record.review.currentSnapshotId,
  );
  if (snapshot === undefined) {
    throw new Error("The test review has no current snapshot.");
  }
  return snapshot;
}

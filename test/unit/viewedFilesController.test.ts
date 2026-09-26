import { describe, expect, it, vi } from "vitest";

import type { ReviewRecord } from "../../src/domain/comments";
import { viewedFileFingerprint } from "../../src/review/viewedFiles";
import type { RevealFileRequest } from "../../src/vscode/activeReviewTree";
import {
  VIEWED_CONTEXT_KEYS,
  ViewedFilesController,
  type ViewedFilesService,
  type ViewedFilesVscodeApi,
} from "../../src/vscode/viewedFilesController";
import { makeReviewRecord } from "./storageFixtures";

describe("viewed files controller", () => {
  it("shows progress, sets the diff editor context, and unmarks the active editor's file", async () => {
    const harness = createHarness(viewedRecord());
    harness.editor.current = { document: { uri: harness.diffUri } };
    await harness.controller.update();

    expect(harness.statusBar.text).toBe("$(eye) 1/1 viewed");
    expect(harness.statusBar.show).toHaveBeenCalled();
    expect(harness.contexts.get(VIEWED_CONTEXT_KEYS.viewable)).toBe(true);
    expect(harness.contexts.get(VIEWED_CONTEXT_KEYS.viewed)).toBe(true);

    await harness.controller.unmark();
    expect(harness.service.setFileViewed).toHaveBeenCalledWith({
      reviewId: harness.request.reviewId,
      snapshotId: harness.request.snapshotId,
      view: harness.request.view,
      fileId: harness.request.fileId,
      viewed: false,
    });
    harness.controller.dispose();
  });

  it("marks the file named by a tree item and clears the context outside a review file", async () => {
    const harness = createHarness(makeReviewRecord("a".repeat(64)));
    await harness.controller.update();

    expect(harness.statusBar.text).toBe("$(eye) 0/1 viewed");
    expect(harness.contexts.get(VIEWED_CONTEXT_KEYS.viewable)).toBe(false);
    expect(harness.contexts.get(VIEWED_CONTEXT_KEYS.viewed)).toBe(false);

    await harness.controller.mark(harness.treeItem);
    expect(harness.service.setFileViewed).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: harness.request.fileId, viewed: true }),
    );
    await expect(harness.controller.mark()).rejects.toThrow(
      "Open or select an InReview file",
    );
    harness.controller.dispose();
  });

  it("hides the progress without an active review", async () => {
    const harness = createHarness(undefined);
    await harness.controller.update();

    expect(harness.statusBar.hide).toHaveBeenCalled();
    expect(harness.contexts.get(VIEWED_CONTEXT_KEYS.viewable)).toBe(false);
    harness.controller.dispose();
  });
});

function viewedRecord(): ReviewRecord {
  const record = makeReviewRecord("a".repeat(64));
  const file = record.snapshots[0]?.views.find(
    ({ identity }) => identity.mode === "combined",
  )?.files[0];
  if (file === undefined) {
    throw new Error("The fixture has no combined file.");
  }
  return {
    ...record,
    viewedFiles: [
      {
        path: "file.txt",
        fingerprint: viewedFileFingerprint(file),
        viewedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  };
}

function createHarness(record: ReviewRecord | undefined) {
  const request: RevealFileRequest = {
    reviewId: record?.review.id ?? "00000000-0000-4000-8000-000000000001",
    snapshotId: record?.review.currentSnapshotId ?? "00000000-0000-4000-8000-000000000002",
    view: { mode: "combined" },
    fileId: "file-a",
    readOnly: false,
  };
  const diffUri = { scheme: "inreview-modified", toString: () => "diff" };
  const treeItem = { command: { arguments: [request] } };
  const editor: { current: { document: { uri: unknown } } | undefined } = {
    current: undefined,
  };
  const statusBar = {
    text: "",
    tooltip: "",
    command: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
  const contexts = new Map<string, unknown>();
  const service = {
    getActiveReviewOrUndefined: vi.fn(() => Promise.resolve(record)),
    setFileViewed: vi.fn(() => Promise.resolve(record)),
    subscribe: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const api = {
    window: {
      get activeTextEditor() {
        return editor.current;
      },
      onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
      createStatusBarItem: vi.fn(() => statusBar),
    },
    commands: {
      executeCommand: vi.fn((_command: string, key: string, value: unknown) => {
        contexts.set(key, value);
        return Promise.resolve();
      }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
  } as unknown as ViewedFilesVscodeApi;
  const controller = new ViewedFilesController({
    service: service as unknown as ViewedFilesService,
    fileRequestFrom: (values) =>
      values[0] === diffUri || values[0] === treeItem ? request : undefined,
    vscode: api,
  });
  return {
    controller,
    service,
    statusBar,
    contexts,
    editor,
    diffUri,
    treeItem,
    request,
  };
}

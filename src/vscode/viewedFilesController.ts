import type * as vscode from "vscode";

import type { ReviewRecord } from "../domain/comments";
import { viewIdentityKey, type Snapshot } from "../domain/review";
import type { ReviewService } from "../review/reviewService";
import {
  viewedFilePath,
  viewedProgress,
  viewedStates,
  type ViewedState,
} from "../review/viewedFiles";
import type { RevealFileRequest } from "./activeReviewTree";

/** Context keys the diff editor title and context menus read. */
export const VIEWED_CONTEXT_KEYS = {
  viewable: "inreview.activeFileViewable",
  viewed: "inreview.activeFileViewed",
} as const;

export type ViewedFilesService = Pick<
  ReviewService,
  "getActiveReviewOrUndefined" | "setFileViewed" | "subscribe"
>;

export interface ViewedFilesVscodeApi {
  readonly window: Pick<
    typeof vscode.window,
    "activeTextEditor" | "onDidChangeActiveTextEditor" | "createStatusBarItem"
  >;
  readonly commands: Pick<typeof vscode.commands, "executeCommand">;
  readonly StatusBarAlignment: typeof vscode.StatusBarAlignment;
}

export interface ViewedFilesControllerOptions {
  readonly service: ViewedFilesService;
  /** Finds the review file named by command arguments (a diff URI or a tree item). */
  readonly fileRequestFrom: (
    values: readonly unknown[],
  ) => RevealFileRequest | undefined;
  readonly vscode: ViewedFilesVscodeApi;
  readonly logError?: (message: string, error: unknown) => void;
}

interface ActiveReviewViewedState {
  readonly record: ReviewRecord;
  readonly snapshot: Snapshot;
  readonly states: ReadonlyMap<string, ViewedState>;
}

/**
 * The human reviewer's Mark/Unmark File as Viewed commands, the context keys
 * that pick the matching diff editor action, and the "k/N viewed" status bar
 * item for the active review.
 */
export class ViewedFilesController implements vscode.Disposable {
  readonly #options: ViewedFilesControllerOptions;
  readonly #statusBar: vscode.StatusBarItem;
  readonly #disposables: readonly vscode.Disposable[];
  // read once per review change, not per editor switch: a large review's
  // manifest is megabytes of validated JSON
  #active: Promise<ActiveReviewViewedState | undefined> | undefined;
  #generation = 0;

  public constructor(options: ViewedFilesControllerOptions) {
    this.#options = options;
    this.#statusBar = options.vscode.window.createStatusBarItem(
      options.vscode.StatusBarAlignment.Left,
      50,
    );
    this.#statusBar.command = "inreview.activeReview.focus";
    this.#disposables = [
      this.#statusBar,
      options.vscode.window.onDidChangeActiveTextEditor(() => {
        void this.update();
      }),
      options.service.subscribe(() => {
        this.#active = undefined;
        void this.update();
      }),
    ];
    void this.update();
  }

  public async mark(...values: readonly unknown[]): Promise<void> {
    await this.setViewed(values, true);
  }

  public async unmark(...values: readonly unknown[]): Promise<void> {
    await this.setViewed(values, false);
  }

  /** Recomputes the status bar and the active editor's context keys. */
  public async update(): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    try {
      this.#active ??= this.readActiveReview();
      const active = await this.#active;
      if (generation !== this.#generation) {
        return;
      }
      if (active === undefined) {
        this.#statusBar.hide();
        await this.setContext(undefined);
        return;
      }
      const { record, snapshot, states } = active;
      const progress = viewedProgress(states);
      this.#statusBar.text = `$(eye) ${String(progress.viewed)}/${String(progress.total)} viewed`;
      this.#statusBar.tooltip = `InReview: ${String(progress.viewed)} of ${String(progress.total)} files viewed${
        progress.changed > 0
          ? `, ${String(progress.changed)} changed since viewed`
          : ""
      }`;
      this.#statusBar.show();
      await this.setContext(
        activeFileState(record, snapshot, states, this.activeEditorRequest()),
      );
    } catch (error) {
      this.#active = undefined;
      this.#options.logError?.("Could not update the viewed-file state", error);
    }
  }

  public dispose(): void {
    this.#generation += 1;
    for (const disposable of [...this.#disposables].reverse()) {
      disposable.dispose();
    }
  }

  private async setViewed(
    values: readonly unknown[],
    viewed: boolean,
  ): Promise<void> {
    const request =
      this.#options.fileRequestFrom(values) ?? this.activeEditorRequest();
    if (request === undefined) {
      throw new TypeError("Open or select an InReview file and try again.");
    }
    await this.#options.service.setFileViewed({
      reviewId: request.reviewId,
      snapshotId: request.snapshotId,
      view: request.view,
      fileId: request.fileId,
      viewed,
    });
  }

  private async readActiveReview(): Promise<
    ActiveReviewViewedState | undefined
  > {
    const record = await this.#options.service.getActiveReviewOrUndefined();
    const snapshot = record?.snapshots.find(
      ({ id }) => id === record.review.currentSnapshotId,
    );
    return record === undefined || snapshot === undefined
      ? undefined
      : { record, snapshot, states: viewedStates(record, snapshot) };
  }

  private activeEditorRequest(): RevealFileRequest | undefined {
    const uri = this.#options.vscode.window.activeTextEditor?.document.uri;
    return uri === undefined ? undefined : this.#options.fileRequestFrom([uri]);
  }

  private async setContext(state: ViewedState | undefined): Promise<void> {
    await this.#options.vscode.commands.executeCommand(
      "setContext",
      VIEWED_CONTEXT_KEYS.viewable,
      state !== undefined,
    );
    await this.#options.vscode.commands.executeCommand(
      "setContext",
      VIEWED_CONTEXT_KEYS.viewed,
      state === "viewed",
    );
  }
}

/** The viewed state of the file an editor shows, when it is a current file of the active review. */
function activeFileState(
  record: ReviewRecord,
  snapshot: Snapshot,
  states: ReadonlyMap<string, ViewedState>,
  request: RevealFileRequest | undefined,
): ViewedState | undefined {
  if (
    request?.reviewId !== record.review.id ||
    request.snapshotId !== snapshot.id
  ) {
    return undefined;
  }
  const file = snapshot.views
    .find(
      ({ identity }) => viewIdentityKey(identity) === viewIdentityKey(request.view),
    )
    ?.files.find(({ fileId }) => fileId === request.fileId);
  return file === undefined ? undefined : states.get(viewedFilePath(file));
}

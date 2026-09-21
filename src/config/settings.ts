import * as vscode from "vscode";
import { executablePath } from "./executablePath";

export interface InReviewSettings {
  readonly jjPath: string;
  readonly defaultChangeCount: number;
  readonly largeDiffWarningLines: number;
  readonly mcpEnabled: boolean;
  readonly logLevel: "error" | "warn" | "info" | "debug";
  readonly ignoreWorkingCopy: boolean;
}

export function readSettings(resource?: vscode.Uri): InReviewSettings {
  const configuration = vscode.workspace.getConfiguration("inreview", resource);
  return {
    jjPath: executablePath(
      configuration.get<string>("jj.path"),
      "jj",
      workspaceRoots(resource),
    ),
    ignoreWorkingCopy: configuration.get<boolean>("jj.ignoreWorkingCopy") !== false,
    defaultChangeCount: positiveInteger(
      configuration.get<number>("review.defaultChangeCount"),
      1,
    ),
    largeDiffWarningLines: nonNegativeInteger(
      configuration.get<number>("review.largeDiffWarningLines"),
      10_000,
    ),
    mcpEnabled: configuration.get<boolean>("mcp.enabled") !== false,
    logLevel: parseLogLevel(configuration.get<string>("logging.level")),
  };
}

function workspaceRoots(resource?: vscode.Uri): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = folders.map((folder) => folder.uri.fsPath);
  const own = resource === undefined ? undefined : vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath;
  return own === undefined || roots.includes(own) ? roots : [...roots, own];
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function parseLogLevel(
  value: string | undefined,
): InReviewSettings["logLevel"] {
  return value === "error" ||
    value === "warn" ||
    value === "debug" ||
    value === "info"
    ? value
    : "info";
}

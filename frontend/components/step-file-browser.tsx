"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  FolderOpen,
  FileBox,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Download,
  Code,
  FileText,
  X,
} from "lucide-react";

interface StepFileEntry {
  name: string;
  size: number;
}

interface ShapeRecord {
  id: string;
  step_file: string;
  description: string;
  code: string;
  created_at: string;
}

interface StepFileBrowserProps {
  /** Base URL used to fetch the file list and download files. */
  apiBaseUrl?: string;
  /** Called when the user clicks a file to load it in the viewer. */
  onSelectFile?: (fileUrl: string, fileName: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A collapsible panel that lists the STEP files tracked by backend job data
 * and lets the user open them in the viewer.
 * Also shows shape metadata (description + code) when available.
 */
export function StepFileBrowser({
  apiBaseUrl = "/api",
  onSelectFile,
}: StepFileBrowserProps) {
  const [files, setFiles] = useState<StepFileEntry[]>([]);
  const [records, setRecords] = useState<ShapeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [filesRes, recordsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/jobs/step-files`),
        fetch(`${apiBaseUrl}/shape-records`),
      ]);
      if (!filesRes.ok) {
        throw new Error(`Failed to fetch file list (${filesRes.status})`);
      }
      const filesData: StepFileEntry[] = await filesRes.json();
      setFiles(filesData);

      if (recordsRes.ok) {
        const recordsData: ShapeRecord[] = await recordsRes.json();
        setRecords(recordsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  // Fetch the file list on mount.
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  /** Find the most recent metadata record for a given STEP filename. */
  const getRecordForFile = useCallback(
    (fileName: string): ShapeRecord | undefined => {
      // Return the last matching record (most recent).
      for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].step_file === fileName) return records[i];
      }
      return undefined;
    },
    [records],
  );

  return (
    <div className="absolute left-4 bottom-4 top-16 w-72 flex flex-col pointer-events-none z-10">
      {/* Toggle button */}
      <div className="flex justify-start mb-2 pointer-events-auto">
        <Button
          variant="outline"
          size="sm"
          className="bg-card/95 backdrop-blur shadow-md"
          onClick={() => setIsCollapsed((c) => !c)}
        >
          <FolderOpen className="mr-2 size-4" />
          Files
          {isCollapsed ? (
            <ChevronUp className="ml-2 size-4" />
          ) : (
            <ChevronDown className="ml-2 size-4" />
          )}
        </Button>
      </div>

      {!isCollapsed && (
        <div className="flex flex-1 flex-col rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg overflow-hidden pointer-events-auto max-h-[50vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-sm font-medium">STEP Files</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={fetchFiles}
              disabled={isLoading}
              title="Refresh file list"
            >
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* File list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-1">
              {isLoading && files.length === 0 && (
                <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                  <Spinner className="size-4" />
                  <span className="text-xs">Loading…</span>
                </div>
              )}

              {error && (
                <p className="text-xs text-destructive text-center py-4">
                  {error}
                </p>
              )}

              {!isLoading && !error && files.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No STEP files yet. Use the chat to generate one!
                </p>
              )}

              {files.map((file) => {
                const record = getRecordForFile(file.name);
                const isExpanded = expandedFile === file.name;

                return (
                  <div key={file.name}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted transition-colors group"
                        onClick={() =>
                          onSelectFile?.(
                            `${apiBaseUrl}/jobs/step-files/${encodeURIComponent(file.name)}`,
                            file.name,
                          )
                        }
                        title={`Open ${file.name}`}
                      >
                        <FileBox className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)}
                          </p>
                        </div>
                        <Download className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity" />
                      </button>

                      {record && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          onClick={() =>
                            setExpandedFile(isExpanded ? null : file.name)
                          }
                          title="Show details"
                        >
                          {isExpanded ? (
                            <X className="size-3.5" />
                          ) : (
                            <FileText className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Expanded metadata panel */}
                    {isExpanded && record && (
                      <div className="mx-2 mb-2 rounded-lg border border-border bg-muted/50 p-3 space-y-2 text-xs">
                        <div>
                          <div className="flex items-center gap-1 font-medium text-foreground mb-1">
                            <FileText className="size-3" />
                            Description
                          </div>
                          <p className="text-muted-foreground whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                            {record.description}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center gap-1 font-medium text-foreground mb-1">
                            <Code className="size-3" />
                            Code
                          </div>
                          <pre className="text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-y-auto bg-background rounded p-2 border border-border font-mono text-[11px]">
                            {record.code}
                          </pre>
                        </div>
                        <p className="text-muted-foreground/60">
                          Generated{" "}
                          {new Date(record.created_at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

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
} from "lucide-react";

interface StepFileEntry {
  name: string;
  size: number;
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
 * A collapsible panel that lists the STEP files stored in the backend's
 * `/data` directory and lets the user open them in the viewer.
 */
export function StepFileBrowser({
  apiBaseUrl = "/api",
  onSelectFile,
}: StepFileBrowserProps) {
  const [files, setFiles] = useState<StepFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/step-files`);
      if (!res.ok) {
        throw new Error(`Failed to fetch file list (${res.status})`);
      }
      const data: StepFileEntry[] = await res.json();
      setFiles(data);
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

              {files.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted transition-colors group"
                  onClick={() =>
                    onSelectFile?.(`${apiBaseUrl}/step-files/${encodeURIComponent(file.name)}`, file.name)
                  }
                  title={`Open ${file.name}`}
                >
                  <FileBox className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <Download className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

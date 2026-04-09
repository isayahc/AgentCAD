"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Send,
  ImagePlus,
  X,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/** A single chat message. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Data-URL of an attached image, if any. */
  imageDataUrl?: string;
}

interface ChatPanelProps {
  /** The base URL of the backend API (e.g. "http://localhost:8000"). */
  apiBaseUrl?: string;
}

/**
 * Chat interface that sends text (+optional image) to the backend
 * `POST /run-agent` endpoint and displays the conversation.
 *
 * Supports:
 * - Plain text messages
 * - Image upload via file picker
 * - Image paste from clipboard (Ctrl+V / ⌘V)
 * - Image + text together
 */
export function ChatPanel({ apiBaseUrl = "/api" }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgCounter = useRef(0);

  // Auto-scroll to the bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /* ------------------------------------------------------------------ */
  /*  Image helpers                                                      */
  /* ------------------------------------------------------------------ */

  const setImageFile = useCallback((file: File | null) => {
    setAttachedImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      if (file && file.type.startsWith("image/")) {
        setImageFile(file);
      }
      // Reset so the same file can be re-selected.
      if (e.target) e.target.value = "";
    },
    [setImageFile],
  );

  /** Handle paste – extract image from clipboard if available. */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            setImageFile(file);
            // Don't prevent default so text paste still works.
          }
          break;
        }
      }
    },
    [setImageFile],
  );

  const clearImage = useCallback(() => {
    setImageFile(null);
  }, [setImageFile]);

  /* ------------------------------------------------------------------ */
  /*  Send message                                                       */
  /* ------------------------------------------------------------------ */

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed && !attachedImage) return;

    const userMessage: ChatMessage = {
      id: `msg-${++msgCounter.current}`,
      role: "user",
      text: trimmed || "(image)",
      imageDataUrl: imagePreview ?? undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setImageFile(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("question", trimmed || "Describe this image");
      if (attachedImage) {
        formData.append("image", attachedImage);
      }

      const res = await fetch(`${apiBaseUrl}/run-agent`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errBody.detail ?? `Request failed (${res.status})`);
      }

      const data: { response: string } = await res.json();

      const assistantMessage: ChatMessage = {
        id: `msg-${++msgCounter.current}`,
        role: "assistant",
        text: data.response,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errText = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${++msgCounter.current}`,
          role: "assistant",
          text: `⚠️ Error: ${errText}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, attachedImage, imagePreview, apiBaseUrl, setImageFile]);

  /** Allow sending with Enter (Shift+Enter for newline). */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="absolute right-4 bottom-4 top-16 w-96 flex flex-col pointer-events-none z-10">
      {/* Toggle button (always visible) */}
      <div className="flex justify-end mb-2 pointer-events-auto">
        <Button
          variant="outline"
          size="sm"
          className="bg-card/95 backdrop-blur shadow-md"
          onClick={() => setIsCollapsed((c) => !c)}
        >
          <MessageSquare className="mr-2 size-4" />
          Chat
          {isCollapsed ? (
            <ChevronUp className="ml-2 size-4" />
          ) : (
            <ChevronDown className="ml-2 size-4" />
          )}
        </Button>
      </div>

      {!isCollapsed && (
        <div className="flex flex-1 flex-col rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg overflow-hidden pointer-events-auto">
          {/* Messages area */}
          <ScrollArea className="flex-1 min-h-0">
            <div ref={scrollRef} className="p-4 space-y-4 max-h-[calc(100vh-320px)] overflow-y-auto">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Send a message to start generating CAD models.
                </p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-1 ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  {msg.imageDataUrl && (
                    <img
                      src={msg.imageDataUrl}
                      alt="attached"
                      className="max-w-48 max-h-36 rounded-lg border border-border object-contain"
                    />
                  )}
                  <div
                    className={`rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" />
                  <span className="text-xs">Generating…</span>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Image preview */}
          {imagePreview && (
            <div className="px-4 pb-1 flex items-center gap-2">
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="preview"
                  className="h-14 w-14 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-white p-0.5"
                  onClick={clearImage}
                  aria-label="Remove image"
                >
                  <X className="size-3" />
                </button>
              </div>
              <span className="text-xs text-muted-foreground truncate">
                {attachedImage?.name ?? "Pasted image"}
              </span>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border p-3 flex items-end gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
              disabled={isLoading}
            >
              <ImagePlus className="size-4" />
            </Button>

            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Describe a CAD model…"
              className="min-h-[40px] max-h-32 resize-none text-sm"
              disabled={isLoading}
              rows={1}
            />

            <Button
              type="button"
              size="icon-sm"
              onClick={sendMessage}
              disabled={isLoading || (!input.trim() && !attachedImage)}
              title="Send"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

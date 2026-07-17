"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";

/**
 * Minimal client-side "copy the brief" button. The brief text is server-rendered
 * into a <pre> and also passed here so a click copies it in one go. Falls back
 * silently if the clipboard API is unavailable (the <pre> is still selectable).
 */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context / permissions). The <pre> block is
      // still there to select manually; do not surface a hard error.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#333] bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-[#c4bebe] transition-colors hover:border-[#e14d1a] hover:text-[#ede6e6]"
      aria-label="Copy brief to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5" weight="bold" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "copied" : "copy brief"}
    </button>
  );
}

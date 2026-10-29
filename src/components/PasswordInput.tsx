"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  autoComplete: "current-password" | "new-password";
};

// One password field for every login/sign-up form, with a show/hide eye
// (founder ruling 2026-10-29). Hidden by default; re-hides when its form submits
// so a browser never saves or shows the value as plain text.
export function PasswordInput({ className = "", ...props }: PasswordInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useRef<[number | null, number | null] | null>(null);
  const [shown, setShown] = useState(false);

  // Native listener on the form fires before React's delegated onSubmit, so the
  // field is back to type="password" before any submit handler runs.
  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!input || !form) return;
    const hide = () => {
      input.type = "password";
      setShown(false);
    };
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  // Changing the input type can reset the caret; put it back where it was.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const saved = selection.current;
    selection.current = null;
    if (input && saved && document.activeElement === input) {
      input.setSelectionRange(saved[0], saved[1]);
    }
  }, [shown]);

  function toggle() {
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      selection.current = [input.selectionStart, input.selectionEnd];
    }
    setShown((s) => !s);
  }

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        type={shown ? "text" : "password"}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={toggle}
        // Keep focus (and the caret) in the field when tapped or clicked.
        // Pointer covers touch, which can focus the button without a mouse event.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 min-h-10 items-center justify-center rounded-r-lg text-[#888] hover:text-[#ede6e6] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#e14d1a] transition-colors"
      >
        {shown ? <EyeSlash size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
}

"use client"

import { useState, useTransition } from "react"
import { Globe, ArrowRight, UploadSimple, Palette } from "@phosphor-icons/react"
import { brandToCssVars } from "@/lib/theme"
import type { Brand, CompanyData } from "@/lib/research/website"

export interface ResearchResult {
  brand: Brand
  company: CompanyData
  botWalled: boolean
}

interface WebsiteStepProps {
  sessionId?: string
  onDone: (result: ResearchResult) => void
}

function applyTheme(brand: Brand) {
  const vars = brandToCssVars(brand)
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value)
  }
}

const S = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    maxWidth: 480,
    width: "100%",
  } as React.CSSProperties,
  label: {
    fontSize: 14,
    color: "var(--mate-accent, #ede6e6)",
    opacity: 0.9,
  } as React.CSSProperties,
  row: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: "#1c1c1c",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: "12px 14px",
    color: "var(--mate-accent, #ede6e6)",
    fontSize: 15,
    outline: "none",
  } as React.CSSProperties,
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "var(--mate-primary, #e14d1a)",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  } as React.CSSProperties,
  logo: {
    height: 48,
    width: "auto",
    alignSelf: "flex-start",
  } as React.CSSProperties,
  error: {
    fontSize: 13,
    color: "#f5a97f",
  } as React.CSSProperties,
  fallbackCard: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    background: "#1c1c1c",
    border: "1px solid #333333",
    borderRadius: 10,
    padding: 16,
  } as React.CSSProperties,
  fallbackRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 14,
    color: "var(--mate-accent, #ede6e6)",
  } as React.CSSProperties,
  hint: {
    fontSize: 13,
    color: "#888888",
  } as React.CSSProperties,
}

export default function WebsiteStep({ sessionId, onDone }: WebsiteStepProps) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [showFallback, setShowFallback] = useState(false)
  const [manualColor, setManualColor] = useState("#e14d1a")
  const [manualLogo, setManualLogo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleResearch() {
    setError(null)
    if (url.trim() === "") {
      setError("Enter your website URL to continue.")
      return
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, sessionId }),
        })
        if (!res.ok) {
          setError("We could not reach that site. Try again or set it up manually.")
          setShowFallback(true)
          return
        }
        const result = (await res.json()) as ResearchResult
        const { brand, botWalled } = result
        const hasBrand = brand.logo_url !== null

        if (botWalled || !hasBrand) {
          // Nothing useful pulled, offer the manual path.
          setShowFallback(true)
          if (hasBrand && brand.logo_url) {
            setLogoPreview(brand.logo_url)
          }
          return
        }

        applyTheme(brand)
        if (brand.logo_url) setLogoPreview(brand.logo_url)
        onDone(result)
      } catch {
        setError("Something went wrong reaching that site. Try manual setup.")
        setShowFallback(true)
      }
    })
  }

  function handleManualLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setManualLogo(dataUrl)
      setLogoPreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  function handleManualApply() {
    const brand: Brand = {
      logo_url: manualLogo,
      colors: {
        primary: manualColor,
        bg: "#141414",
        accent: "#ede6e6",
        source: "default",
      },
    }
    applyTheme(brand)

    // Persist the manually-chosen brand (logo + primary color) to the session so
    // a bot-walled client's branding survives a reload. Fire-and-forget: a save
    // hiccup must not block the owner from continuing into the chat.
    if (sessionId) {
      fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, brand }),
      }).catch(() => {
        // Non-fatal: the theme is already applied locally and the chat step
        // carries the brand forward in memory for this session.
      })
    }

    onDone({ brand, company: {}, botWalled: true })
  }

  return (
    <div style={S.wrap}>
      <label style={S.label} htmlFor="mate-website-url">
        What is your website?
      </label>

      <div style={S.row}>
        <input
          id="mate-website-url"
          style={S.input}
          type="text"
          inputMode="url"
          placeholder="yourcompany.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleResearch()
          }}
          disabled={pending}
        />
        <button
          style={{ ...S.button, ...(pending ? S.buttonDisabled : {}) }}
          onClick={handleResearch}
          disabled={pending}
          type="button"
        >
          {pending ? (
            <>
              <Globe size={18} weight="bold" />
              Looking…
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={18} weight="bold" />
            </>
          )}
        </button>
      </div>

      {error && <p style={S.error}>{error}</p>}

      {logoPreview && (
        <img src={logoPreview} alt="Your logo" style={S.logo} />
      )}

      {showFallback && (
        <div style={S.fallbackCard}>
          <p style={S.hint}>
            We could not pull your branding automatically. Set it up here.
          </p>

          <label style={S.fallbackRow}>
            <UploadSimple size={20} weight="bold" />
            <span>Upload your logo</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleManualLogoChange}
              style={{ fontSize: 13 }}
            />
          </label>

          <label style={S.fallbackRow}>
            <Palette size={20} weight="bold" />
            <span>Primary color</span>
            <input
              type="color"
              value={manualColor}
              onChange={(e) => setManualColor(e.target.value)}
              style={{
                width: 40,
                height: 28,
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            />
          </label>

          <button style={S.button} onClick={handleManualApply} type="button">
            Apply and continue
            <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}

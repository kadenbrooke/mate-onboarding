// Side-by-side: Mate's AI features on Gemini (the old routes) vs Claude (the
// new routes), through the real production code paths.
//
// FAKE INPUTS ONLY. Every note, lead, photo, web page and text below is
// invented (555-01xx phone numbers, example.com/.org emails). Never add a real
// client record here.
//
// Arms:
//   gemini-carson  the old Gemini models on GEMINI_API_KEY_CARSON (J&C's old route)
//   gemini-shared  the old Gemini models on the shared GEMINI_API_KEY (the old
//                  demo funnel and every other tenant)
//   claude-jc      J&C's session (pinned in src/lib/demo/tenantModels.ts)
//   claude-demo    no tenant: the prospect demo funnel and the public demo
//   claude-other   an unmapped (fake) tenant session
// The Gemini arms force TASK_MODELS back to the models each class ran on before
// 2026-11-16 (extract/assistant/vision gemini-3.6-flash, reply gemini-2.5-flash).
//
// Demo-only tasks (website -> company profile, First Responder SMS reply) always
// run with no tenant, so they run on the gemini arms and claude-demo only.
//
// Second table: the three features that ran on OpenAI gpt-4o-mini before
// 2026-11-16 (onboarding website research, the sandbox reply, the onboarding
// chat with tools), old model vs Claude, through the same code the routes call. The
// SMS reply here goes through the app's `reply` class; the edge function
// (supabase/functions/_shared/portkey.ts) sends the same model id through the
// same gateway with an 800-token budget, which this mirrors.
//
// Run (see vitest.eval.config.mts): prints a score table and writes
// results.json plus the rendered fake photos to EVAL_OUT (default: a temp dir).
// Key values are never printed; only HTTP statuses and scores.

import { it } from "vitest"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { chatComplete, portkeyChatStream, visionComplete, modelFor, TASK_MODELS, TASK_PARAMS, type TaskClass } from "@/lib/demo/portkey"
import { extractCompanyDataViaPortkey } from "@/lib/demo/extract"
import { buildFrConfig } from "@/lib/demo/fr-config"
import { extractNoteFields, type NoteFields } from "@/lib/agent/noteExtract"
import { buildAssistantContext } from "@/lib/assistant/context"
import { pipelineTotals, type Lead } from "@/lib/metrics/leads"
import { streamText, tool } from "ai"
import { portkeyLanguageModel } from "@/lib/demo/portkeyModel"
import { extractCompanyData } from "@/lib/research/website"
import { sandboxSystemPrompt } from "@/lib/mate/sandbox-agent"
import { mateSystemPrompt } from "@/lib/mate/system-prompt"
import { toolSchemas } from "@/lib/mate/tools"
import { capabilitySummary } from "@/lib/mate/capability"
import { missingRequired, REQUIRED_LABELS } from "@/lib/mate/required-fields"
import { snapshotPrompt } from "@/lib/leads/snapshotPrompt"
import { parseSnapshotReply } from "@/lib/leads/snapshotParse"

const JC = "61400e73-0570-4167-88d9-d3a69650b15b"
const OTHER_TENANT = "0b5e7a1c-1111-4222-8333-944455556666" // fake, unmapped
const OUT = process.env.EVAL_OUT ?? join(tmpdir(), `mate-claude-eval-${Date.now()}`)

type Arm = {
  id: "gemini-carson" | "gemini-shared" | "claude-jc" | "claude-demo" | "claude-other"
  session: string | null
  gemini?: string // env var whose key the forced Gemini models use
  demoTasks: boolean
}
const ARMS: Arm[] = [
  { id: "gemini-carson", session: null, gemini: "GEMINI_API_KEY_CARSON", demoTasks: true },
  { id: "gemini-shared", session: null, gemini: "GEMINI_API_KEY", demoTasks: true },
  { id: "claude-jc", session: JC, demoTasks: false },
  { id: "claude-demo", session: null, demoTasks: true },
  { id: "claude-other", session: OTHER_TENANT, demoTasks: false },
]

const OLD_GEMINI_MODELS: Record<TaskClass, string> = {
  extract: "google/gemini-3.6-flash",
  reply: "google/gemini-2.5-flash",
  assistant: "google/gemini-3.6-flash",
  vision: "google/gemini-3.6-flash",
  // The onboarding chat was never on Gemini (it was gpt-4o-mini); unused by these arms.
  onboarding: "openai/gpt-4o-mini",
}

// The formerly-OpenAI features, old model vs the Claude defaults.
const OLD_OPENAI = "openai/gpt-4o-mini"
const OPENAI_PATH_ARMS: { id: string; models: Partial<Record<TaskClass, string>> }[] = [
  { id: "openai-old", models: { extract: OLD_OPENAI, reply: OLD_OPENAI, onboarding: OLD_OPENAI } },
  { id: "claude", models: {} },
]
const CLAUDE_MODELS = { ...TASK_MODELS } as Record<TaskClass, string>
// Captured once, before any arm rewrites GEMINI_API_KEY: reading process.env
// per arm would hand a later arm the previous arm's key.
const SHARED_GEMINI = process.env.GEMINI_API_KEY
const GEMINI_KEYS: Record<string, string | undefined> = {
  GEMINI_API_KEY: SHARED_GEMINI,
  GEMINI_API_KEY_CARSON: process.env.GEMINI_API_KEY_CARSON,
}
function selectArm(arm: Arm) {
  const models = TASK_MODELS as unknown as Record<TaskClass, string>
  Object.assign(models, arm.gemini ? OLD_GEMINI_MODELS : CLAUDE_MODELS)
  // The edge function sent Gemini reasoning_effort "none" on SMS replies; mirror it.
  if (arm.gemini) TASK_PARAMS.reply = { reasoning_effort: "none" }
  else delete TASK_PARAMS.reply
  // The no-tenant route reads GEMINI_API_KEY, so point it at the arm's key.
  process.env.GEMINI_API_KEY = arm.gemini ? GEMINI_KEYS[arm.gemini] : SHARED_GEMINI
}
const modelLabel = (arm: Arm, cls: TaskClass) => modelFor(cls, arm.session)

// ---------------------------------------------------------------------------
// Key probe: does each arm's key answer at all? Status only.
// ---------------------------------------------------------------------------

async function probe(arm: Arm): Promise<string> {
  const [provider, model] = modelLabel(arm, "extract").split(/\/(.*)/)
  const key = provider === "google" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY
  if (!key) return "no key in env"
  const res = await fetch(`${process.env.PORTKEY_BASE_URL ?? "https://portkey.auto-mate.business"}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "x-portkey-provider": provider,
      "x-portkey-metadata": JSON.stringify({ app: "mate-onboarding", surface: "eval" }),
      ...(process.env.PORTKEY_GATEWAY_KEY ? { "x-amos-gateway-key": process.env.PORTKEY_GATEWAY_KEY } : {}),
    },
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Say ok." }] }),
  })
  if (res.ok) return `${res.status}`
  const body = await res.text().catch(() => "")
  const code = /"status"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? /"type"\s*:\s*"([a-z_]+_error)"/.exec(body)?.[1] ?? ""
  return `${res.status} ${code}`.trim()
}

// ---------------------------------------------------------------------------
// Demo A. Website -> company profile (extract class, src/lib/demo/extract.ts)
// ---------------------------------------------------------------------------

type GoldSite = { html: string; name: string; phoneDigits: string | null; service: string; email: string | null }
const page = (title: string, body: string) =>
  `<html><head><title>${title}</title><style>.x{color:red}</style><script>var t=1</script></head><body>${body}</body></html>`
const SITES: GoldSite[] = [
  { html: page("Home", `<nav>Home About Contact</nav><h1>Summit Ridge Paving</h1><p>Family owned since 1998. We do asphalt driveways, sealcoating and crack filling across Utah County.</p><p>Call (801) 555-0181. Mon-Fri 7am-6pm.</p><footer>123 E Fake Ave, Provo UT</footer>`),
    name: "summit ridge paving", phoneDigits: "8015550181", service: "seal", email: null },
  { html: page("Bright Spark Electric | Licensed Electricians", `<h2>Bright Spark Electric</h2><ul><li>Panel upgrades</li><li>EV charger installs</li><li>Lighting</li></ul><p>Email us: hello@example.com</p><p>Serving Salt Lake and Davis counties.</p>`),
    name: "bright spark electric", phoneDigits: null, service: "panel", email: "hello@example.com" },
  { html: page("Welcome!", `<div class="hero">Clear Flow Plumbing &amp; Drain</div><p>24/7 emergency drain cleaning, water heaters and leak repair.</p><a href="tel:+13855550126">385-555-0126</a>`),
    name: "clear flow plumbing & drain", phoneDigits: "3855550126", service: "drain", email: null },
]

function scoreSite(g: GoldSite, got: { name?: string; phone?: string; services?: string[]; email?: string }) {
  const misses: string[] = []
  const n = (s?: string) => (s ?? "").toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  if (n(got.name) !== g.name) misses.push(`name ${JSON.stringify(got.name)}`)
  const digits = (got.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (g.phoneDigits === null ? !!got.phone : digits !== g.phoneDigits) misses.push(`phone ${JSON.stringify(got.phone)}`)
  if (!(got.services ?? []).some(x => n(x).includes(g.service))) misses.push(`services ${JSON.stringify(got.services)}`)
  if (g.email === null ? !!got.email : n(got.email) !== g.email) misses.push(`email ${JSON.stringify(got.email)}`)
  return { right: 4 - misses.length, total: 4, misses }
}

// ---------------------------------------------------------------------------
// Demo B. First Responder SMS reply (reply class)
// ---------------------------------------------------------------------------

const FR_COMPANY = { name: "Summit Ridge Paving", services: ["asphalt driveways", "sealcoating", "crack filling"] }
const TEXTS = [
  "Hi, saw your ad. How much to sealcoat a driveway?",
  "do you guys do parking lots? we have a small church lot in Orem",
  "Missed your call earlier, what was it about",
]
// Short enough for a text, plain (no markdown), and never a made-up price.
const replyOk = (t: string) => !!t && t.length <= 320 && !/\*\*|^#|^- /m.test(t) && !/\$\s?\d/.test(t)

// ---------------------------------------------------------------------------
// 1. Call-note extraction (extract class, src/lib/agent/noteExtract.ts)
// ---------------------------------------------------------------------------

type GoldNote = {
  note: string
  name: string | null
  email: string | null
  address: { num: string; word: string } | null
  city: string | null
  service: string[] | null // any keyword matches
  quote_cents: number | null
}

const NOTES: GoldNote[] = [
  { note: "talked to Dave Miller, 1450 E Center St in Lehi, wants the driveway sealed, quoted him 2200",
    name: "dave miller", email: null, address: { num: "1450", word: "center" }, city: "lehi", service: ["seal"], quote_cents: 220000 },
  { note: "new lead Karen Wu karen.wu@example.com parking lot restripe at 300 N Main, Springville. said 4,800 is fine",
    name: "karen wu", email: "karen.wu@example.com", address: { num: "300", word: "main" }, city: "springville", service: ["stripe", "striping"], quote_cents: 480000 },
  { note: "left voicemail for the guy on 9th, no answer yet",
    name: null, email: null, address: null, city: null, service: null, quote_cents: null },
  { note: "Jose Ramirez - crack fill + sealcoat, 88 S 400 W American Fork, $1,350",
    name: "jose ramirez", email: null, address: { num: "88", word: "400" }, city: "american fork", service: ["crack", "seal"], quote_cents: 135000 },
  { note: "Spoke w/ Linda (no last name) about patching potholes in her lot in Orem. Will quote after site visit.",
    name: "linda", email: null, address: null, city: "orem", service: ["pothole", "patch"], quote_cents: null },
  { note: "Mike T. wants new asphalt driveway, 2210 N Canyon Rd Provo, quoted 11k",
    name: "mike t", email: null, address: { num: "2210", word: "canyon" }, city: "provo", service: ["driveway", "asphalt"], quote_cents: 1100000 },
  { note: "email from sarah.k@example.org - Sarah Kim, HOA in Draper, wants bids on resurfacing. no price yet",
    name: "sarah kim", email: "sarah.k@example.org", address: null, city: "draper", service: ["resurfac"], quote_cents: null },
  { note: "Bob at 55 W 100 S Salt Lake City, sealcoat, quoted 950 bucks",
    name: "bob", email: null, address: { num: "55", word: "100" }, city: "salt lake city", service: ["seal"], quote_cents: 95000 },
  { note: "Angela Brooks 6120 S Redwood Rd, Taylorsville. Wants speed bumps installed. Quote: $2,750.",
    name: "angela brooks", email: null, address: { num: "6120", word: "redwood" }, city: "taylorsville", service: ["speed bump"], quote_cents: 275000 },
  { note: "Ken Oduya 801-555-0110, repave the church lot on 400 S in Spanish Fork, ballpark 18,500",
    name: "ken oduya", email: null, address: { num: "400", word: "400" }, city: "spanish fork", service: ["pave"], quote_cents: 1850000 },
]

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9@. ]/g, " ").replace(/\s+/g, " ").trim()

function scoreNote(gold: GoldNote, got: NoteFields): { right: number; total: number; misses: string[] } {
  const misses: string[] = []
  const check = (field: string, ok: boolean) => { if (!ok) misses.push(field) }
  check("name", gold.name === null ? got.name == null : norm(got.name).replace(/\./g, "") === gold.name)
  check("email", gold.email === null ? got.email == null : norm(got.email) === gold.email)
  check("address", gold.address === null
    ? got.address == null
    : norm(got.address).includes(gold.address.num) && norm(got.address).includes(gold.address.word))
  check("city", gold.city === null ? got.city == null : norm(got.city) === gold.city)
  check("service", gold.service === null ? got.service == null : gold.service.some(k => norm(got.service).includes(k)))
  check("quote", (got.quote_cents ?? null) === gold.quote_cents)
  return { right: 6 - misses.length, total: 6, misses }
}

// ---------------------------------------------------------------------------
// 2. Dashboard assistant (assistant class, streamed like the chat route)
// ---------------------------------------------------------------------------

const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString()
const lead = (i: number, source: Lead["source"], status: Lead["status"], quote: number | null, reply: number | null): Lead => ({
  id: `fake-${i}`, name: `Fake Customer ${i}`, city: "Provo", service: "sealcoat", phone: `+1801555${String(100 + i).padStart(4, "0")}`,
  source, referrer_name: null, score: null, status, quote_cents: quote, contacted: true, after_hours: false,
  first_reply_seconds: reply, created_at: day(i),
})
const LEADS: Lead[] = [
  lead(1, "meta", "open", null, 40), lead(2, "meta", "booked", 180000, 25), lead(3, "referral", "quoted", 320000, 90),
  lead(4, "call", "serviced", 145000, 30), lead(5, "referral", "serviced", 260000, null), lead(6, "google", "open", null, 55),
  lead(7, "meta", "serviced", 99000, 20), lead(8, "text", "quoted", 410000, 35), lead(9, "referral", "open", null, 60),
  lead(10, "meta", "booked", 75000, 45), lead(11, "call", "open", null, null), lead(12, "google", "serviced", 530000, 15),
]

function assistantQuestions() {
  const t = pipelineTotals(LEADS)
  const replies = LEADS.map(l => l.first_reply_seconds).filter((s): s is number => s != null)
  const avg = Math.round(replies.reduce((a, s) => a + s, 0) / replies.length)
  const servicedDollars = Math.round(t.cents.serviced / 100)
  const num = (n: number) => new RegExp(`\\b${n.toLocaleString("en-US").replace(/,/g, ",?")}\\b`)
  return [
    { q: "How many leads do I have in total?", pass: num(LEADS.length) },
    { q: "How many of my leads came from referrals?", pass: num(LEADS.filter(l => l.source === "referral").length) },
    { q: "How much money have my serviced jobs brought in?", pass: num(servicedDollars) },
    { q: "What is my average first reply time?", pass: num(avg) },
    { q: "How many leads did I get from TikTok last month?", pass: /\b(no|none|zero|0|not|doesn't|does not|don't|isn't)\b/i },
  ]
}

async function askAssistant(arm: Arm, question: string): Promise<{ text: string; status: number }> {
  const system = buildAssistantContext(LEADS, "Fake Paving Co", null)
  const res = await portkeyChatStream({ system, messages: [{ role: "user", content: question }], taskClass: "assistant", sessionId: arm.session })
  if (!res.ok || !res.body) return { text: "", status: res.status }
  // Same SSE parse as src/app/api/assistant/chat/route.ts.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") continue
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        full += json.choices?.[0]?.delta?.content ?? ""
      } catch { /* keep-alive */ }
    }
  }
  return { text: full.trim(), status: res.status }
}

// ---------------------------------------------------------------------------
// 3. Lead Snapshot photo reading (vision class)
// ---------------------------------------------------------------------------

type GoldLead = { name: string; phoneDigits: string; address: { num: string; word: string } | null }
type Photo = { id: string; lines: string[]; font: string; rotate: number; leads: GoldLead[] }

const PHOTOS: Photo[] = [
  { id: "single", font: "Bradley Hand", rotate: -2,
    lines: ["Maria Gonzalez", "801-555-0142", "742 W Elm St, Provo", "driveway sealcoat"],
    leads: [{ name: "maria gonzalez", phoneDigits: "8015550142", address: { num: "742", word: "elm" } }] },
  { id: "two-leads", font: "Marker Felt", rotate: 1.5,
    lines: ["Leads Tues", "1) Tom Reese (385) 555-0199", "    55 N 300 E Orem - crack fill", "2) Priya Patel 801.555.0177", "    1200 S State St Lindon - new lot"],
    leads: [
      { name: "tom reese", phoneDigits: "3855550199", address: { num: "55", word: "300" } },
      { name: "priya patel", phoneDigits: "8015550177", address: { num: "1200", word: "state" } },
    ] },
  { id: "seven-digit", font: "Noteworthy", rotate: -3,
    lines: ["call Gary back", "555-0163", "re: patching"],
    leads: [{ name: "gary", phoneDigits: "5550163", address: null }] },
]

function photoSvg(p: Photo): string {
  const rules = Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${80 + i * 52}" x2="1000" y2="${80 + i * 52}" stroke="#9ec5e8" stroke-width="2"/>`).join("")
  const text = p.lines.map((l, i) =>
    `<text x="70" y="${125 + i * 70}" font-family="${p.font}" font-size="46" fill="#1d2a6b">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="720"><rect width="1000" height="720" fill="#fbf6df"/>${rules}<line x1="50" y1="0" x2="50" y2="720" stroke="#e8a0a0" stroke-width="2"/><g transform="rotate(${p.rotate} 500 360)">${text}</g></svg>`
}

function scorePhoto(p: Photo, text: string | null): { right: number; total: number; extra: number; misses: string[] } {
  const total = p.leads.length * 3
  if (!text) return { right: 0, total, extra: 0, misses: ["no answer"] }
  const parsed = parseSnapshotReply(text)
  if (!parsed.ok) return { right: 0, total, extra: 0, misses: [`parse ${parsed.reason}`] }
  const misses: string[] = []
  let right = 0
  const used = new Set<number>()
  // What the confirm screen would show (fake data only), so a miss is explainable.
  const shown = (c: (typeof parsed.candidates)[number]) =>
    `{name:${JSON.stringify(c.name)} phone:${JSON.stringify(c.phone)} address:${JSON.stringify(c.address)} withheld:[${c.withheld.join(",")}]}`
  for (const g of p.leads) {
    // Match on the first name or, when the name was withheld or misread, the phone digits.
    const idx = parsed.candidates.findIndex((c, i) => !used.has(i) &&
      (norm(c.name).includes(g.name.split(" ")[0]) || (c.phone ?? "").replace(/\D/g, "") === g.phoneDigits))
    if (idx === -1) { misses.push(`${g.name}: not found`); continue }
    used.add(idx)
    const c = parsed.candidates[idx]
    const nameOk = norm(c.name) === g.name
    const phoneOk = (c.phone ?? "").replace(/\D/g, "") === g.phoneDigits
    const addrOk = g.address === null ? c.address == null : norm(c.address).includes(g.address.num) && norm(c.address).includes(g.address.word)
    if (nameOk) right++; else misses.push(`${g.name}: name ${shown(c)}`)
    if (phoneOk) right++; else misses.push(`${g.name}: phone ${shown(c)}`)
    if (addrOk) right++; else misses.push(`${g.name}: address ${shown(c)}`)
  }
  parsed.candidates.forEach((c, i) => { if (!used.has(i)) misses.push(`extra ${shown(c)}`) })
  return { right, total, extra: parsed.candidates.length - used.size, misses }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Formerly-OpenAI features
// ---------------------------------------------------------------------------

// Sandbox: the owner's in-browser First Responder preview (/api/sandbox).
const SANDBOX_COLLECTED = { company: { name: "Summit Ridge Paving" }, services: ["asphalt driveways", "sealcoating"] }

// Onboarding chat (/api/mate): each turn must call the right tool with the right value.
type Call = { tool: string; args: Record<string, unknown> }
const ONBOARD_COMPANY = { name: "Summit Ridge Paving", services: ["sealcoating"] }
const ONBOARDING: { say: string; want: string; pass: (calls: Call[]) => boolean }[] = [
  { say: "Our main business phone is 801-555-0110.", want: "saveField with the phone",
    pass: calls => calls.some(c => c.tool === "saveField" && String(c.args.value).replace(/\D/g, "").endsWith("8015550110")) },
  { say: "We do driveway sealcoating, crack filling and parking lot striping.", want: "confirmServices with all three",
    pass: calls => calls.some(c => c.tool === "confirmServices" && Array.isArray(c.args.services) &&
      (c.args.services as string[]).length >= 3 && (c.args.services as string[]).some(x => /strip/i.test(x))) },
  { say: "Can you also run our Facebook ad campaigns for us?", want: "requestBuild",
    pass: calls => calls.some(c => c.tool === "requestBuild") },
]

async function onboardingTurn(say: string): Promise<{ calls: Call[]; text: string; error: string | null }> {
  const llm = portkeyLanguageModel("onboarding", null, "eval")
  if (!llm.ok) return { calls: [], text: "", error: llm.detail }
  const calls: Call[] = []
  const record = (name: string) => async (args: Record<string, unknown>) => { calls.push({ tool: name, args }); return "Saved." }
  const tools = Object.fromEntries(Object.entries(toolSchemas).map(([name, def]) =>
    [name, tool({ description: def.description, parameters: def.parameters, execute: record(name) as never })]))
  let error: string | null = null
  const result = streamText({
    model: llm.model,
    maxTokens: llm.maxTokens,
    maxSteps: 5,
    system: mateSystemPrompt("Mate", ONBOARD_COMPANY, capabilitySummary([]), missingRequired({}).map(k => REQUIRED_LABELS[k])),
    messages: [{ role: "user", content: say }],
    tools,
    abortSignal: AbortSignal.timeout(60000),
    onError: ({ error: e }) => { error = String(e).slice(0, 200) },
  })
  let text = ""
  for await (const part of result.fullStream) if (part.type === "text-delta") text += part.textDelta
  return { calls, text: text.trim(), error }
}

it("Mate AI features: Gemini vs Claude on fake inputs, J&C and non-J&C routes", async () => {
  mkdirSync(OUT, { recursive: true })
  const pngs = await Promise.all(PHOTOS.map(async p => {
    const bytes = new Uint8Array(await sharp(Buffer.from(photoSvg(p))).png().toBuffer())
    writeFileSync(join(OUT, `${p.id}.png`), bytes)
    return bytes
  }))

  const results: Record<string, unknown> = {}
  const rows: string[] = []
  const rows2: string[] = []
  const ms = (t: number) => `${Math.round((Date.now() - t) / 100) / 10}s`

  try {
    for (const arm of ARMS) {
      selectArm(arm)
      const probeStatus = await probe(arm)
      const r: Record<string, unknown> = { probe: probeStatus, models: { extract: modelLabel(arm, "extract"), assistant: modelLabel(arm, "assistant"), vision: modelLabel(arm, "vision") } }

      // Notes
      let nRight = 0, nTotal = 0, nEmpty = 0
      const noteMisses: string[] = []
      let t = Date.now()
      for (const [i, g] of NOTES.entries()) {
        const got = await extractNoteFields(g.note, arm.session)
        const s = scoreNote(g, got)
        if (Object.values(got).every(v => v == null) && g.name !== null) nEmpty++
        nRight += s.right; nTotal += s.total
        if (s.misses.length) noteMisses.push(`note${i + 1}: ${s.misses.join(",")} got ${JSON.stringify(got)}`)
      }
      const noteTime = ms(t)

      // Assistant
      let aPass = 0
      const aDetail: { q: string; pass: boolean; status: number; answer: string }[] = []
      t = Date.now()
      for (const { q, pass } of assistantQuestions()) {
        const { text, status } = await askAssistant(arm, q)
        const ok = !!text && pass.test(text) && !/\*\*|^#/m.test(text)
        if (ok) aPass++
        aDetail.push({ q, pass: ok, status, answer: text.slice(0, 240) })
      }
      const assistantTime = ms(t)

      // Vision
      let vRight = 0, vTotal = 0, vExtra = 0
      const vDetail: unknown[] = []
      const answeredBy = new Set<string>()
      t = Date.now()
      for (const [i, p] of PHOTOS.entries()) {
        const { system, prompt } = snapshotPrompt()
        const v = await visionComplete({ prompt, system, images: [{ mime: "image/png", bytes: pngs[i] }], sessionId: arm.session })
        if (v.model) answeredBy.add(v.ok ? v.model : `${v.model} (failed: ${v.kind} ${v.detail.slice(0, 3)})`)
        const s = scorePhoto(p, v.ok ? v.text : null)
        vRight += s.right; vTotal += s.total; vExtra += s.extra
        vDetail.push({ photo: p.id, model: v.model, ...s })
      }
      const visionTime = ms(t)

      // Demo-only: website -> profile, and the First Responder SMS reply.
      let sRight = 0, sTotal = 0, rPass = 0
      const siteMisses: string[] = []
      const replies: { text: string; pass: boolean; reply: string }[] = []
      let demoTime = "n/a"
      if (arm.demoTasks) {
        t = Date.now()
        for (const [i, g] of SITES.entries()) {
          const got = await extractCompanyDataViaPortkey(g.html)
          const sc = scoreSite(g, got)
          sRight += sc.right; sTotal += sc.total
          if (sc.misses.length) siteMisses.push(`site${i + 1}: ${sc.misses.join(", ")}`)
        }
        const persona = buildFrConfig(FR_COMPANY).system_prompt
        for (const text of TEXTS) {
          const reply = await chatComplete({ taskClass: "reply", sessionId: null, system: persona, maxTokens: 800, messages: [{ role: "user", content: text }] })
          const pass = replyOk(reply)
          if (pass) rPass++
          replies.push({ text, pass, reply })
        }
        demoTime = ms(t)
      }

      Object.assign(r, {
        site: arm.demoTasks ? { right: sRight, total: sTotal, misses: siteMisses } : null,
        smsReply: arm.demoTasks ? { pass: rPass, total: TEXTS.length, replies, model: modelLabel(arm, "reply") } : null,
        notes: { right: nRight, total: nTotal, emptyAnswers: nEmpty, misses: noteMisses, time: noteTime },
        assistant: { pass: aPass, total: aDetail.length, detail: aDetail, time: assistantTime },
        vision: { right: vRight, total: vTotal, extraCandidates: vExtra, answeredBy: [...answeredBy], detail: vDetail, time: visionTime },
      })
      results[arm.id] = r
      rows.push(
        `${arm.id.padEnd(14)} probe=${probeStatus.padEnd(4)} notes ${nRight}/${nTotal} (empty ${nEmpty}, ${noteTime})  ` +
        `assistant ${aPass}/${aDetail.length} (${assistantTime})  vision ${vRight}/${vTotal} extra=${vExtra} by ${[...answeredBy].join("+") || "none"} (${visionTime})  ` +
        (arm.demoTasks ? `site ${sRight}/${sTotal}  sms ${rPass}/${TEXTS.length} (${demoTime})` : "site n/a  sms n/a"),
      )
    }

    // Second table: the formerly-OpenAI features.
    process.env.GEMINI_API_KEY = SHARED_GEMINI
    delete TASK_PARAMS.reply
    for (const arm of OPENAI_PATH_ARMS) {
      Object.assign(TASK_MODELS as unknown as Record<TaskClass, string>, CLAUDE_MODELS, arm.models)
      let t = Date.now()
      let rsRight = 0, rsTotal = 0
      const researchMisses: string[] = []
      for (const [i, g] of SITES.entries()) {
        const sc = scoreSite(g, await extractCompanyData(g.html))
        rsRight += sc.right; rsTotal += sc.total
        if (sc.misses.length) researchMisses.push(`site${i + 1}: ${sc.misses.join(", ")}`)
      }
      const researchTime = ms(t)
      t = Date.now()
      let sbPass = 0
      const sandbox: { text: string; pass: boolean; reply: string }[] = []
      for (const text of TEXTS) {
        const reply = await chatComplete({
          taskClass: "reply", sessionId: null, system: sandboxSystemPrompt(SANDBOX_COLLECTED, "Mate"),
          messages: [{ role: "user", content: text }], maxTokens: 300,
        })
        const pass = replyOk(reply)
        if (pass) sbPass++
        sandbox.push({ text, pass, reply })
      }
      const sandboxTime = ms(t)
      t = Date.now()
      let obPass = 0
      const onboarding: { say: string; want: string; pass: boolean; calls: Call[]; text: string; error: string | null }[] = []
      for (const c of ONBOARDING) {
        const turn = await onboardingTurn(c.say)
        const pass = !turn.error && c.pass(turn.calls)
        if (pass) obPass++
        onboarding.push({ say: c.say, want: c.want, pass, ...turn })
      }
      const onboardingTime = ms(t)
      results[arm.id] = {
        models: { research: TASK_MODELS.extract, sandbox: TASK_MODELS.reply, onboarding: TASK_MODELS.onboarding },
        research: { right: rsRight, total: rsTotal, misses: researchMisses, time: researchTime },
        sandbox: { pass: sbPass, total: TEXTS.length, replies: sandbox, time: sandboxTime },
        onboarding: { pass: obPass, total: ONBOARDING.length, turns: onboarding, time: onboardingTime },
      }
      rows2.push(
        `${arm.id.padEnd(11)} research ${rsRight}/${rsTotal} (${researchTime}) by ${TASK_MODELS.extract}  ` +
        `sandbox ${sbPass}/${TEXTS.length} (${sandboxTime}) by ${TASK_MODELS.reply}  ` +
        `onboarding ${obPass}/${ONBOARDING.length} (${onboardingTime}) by ${TASK_MODELS.onboarding}`,
      )
    }
  } finally {
    Object.assign(TASK_MODELS as unknown as Record<TaskClass, string>, CLAUDE_MODELS)
    delete TASK_PARAMS.reply
    process.env.GEMINI_API_KEY = SHARED_GEMINI
  }

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2))
  console.log(`\nMate Claude eval (fake inputs), results in ${OUT}\n${rows.join("\n")}\n\nFormerly-OpenAI features\n${rows2.join("\n")}\n`)
  type R = {
    notes: { misses: string[] }; vision: { detail: { photo: string; misses: string[] }[] }
    site: { misses: string[] } | null; smsReply: { replies: { pass: boolean; reply: string }[] } | null
  }
  type R2 = {
    research: { misses: string[] }; sandbox: { replies: { pass: boolean; reply: string }[] }
    onboarding: { turns: { pass: boolean; want: string; calls: Call[]; error: string | null }[] }
  }
  for (const id of OPENAI_PATH_ARMS.map(a => a.id)) {
    const r = results[id] as R2
    console.log(`${id} research misses: ${r.research.misses.join(" | ") || "none"}`)
    for (const x of r.sandbox.replies) if (!x.pass) console.log(`${id} sandbox fail: ${JSON.stringify(x.reply.slice(0, 200))}`)
    for (const x of r.onboarding.turns) if (!x.pass) console.log(`${id} onboarding fail (${x.want}): calls ${JSON.stringify(x.calls).slice(0, 200)} error ${x.error}`)
  }
  for (const [id, r] of Object.entries(results).filter(([id]) => !OPENAI_PATH_ARMS.some(a => a.id === id)) as [string, R][]) {
    console.log(`${id} note misses: ${r.notes.misses.join(" | ") || "none"}`)
    console.log(`${id} vision misses: ${r.vision.detail.map(d => `${d.photo}[${d.misses.join(",")}]`).join(" ")}`)
    if (r.site) console.log(`${id} site misses: ${r.site.misses.join(" | ") || "none"}`)
    if (r.smsReply) for (const x of r.smsReply.replies) if (!x.pass) console.log(`${id} sms fail: ${JSON.stringify(x.reply.slice(0, 200))}`)
  }
})

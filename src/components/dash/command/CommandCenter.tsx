import Link from 'next/link';
import type { ReactNode } from 'react';
// /dist/ssr: rendered from a Server Component (see BackLink).
import {
  Phone, Fire, ChatCircleDots, UserSwitch, Sparkle, CurrencyDollar, HourglassMedium, CheckCircle, CaretRight,
} from '@phosphor-icons/react/dist/ssr';
import type { CommandModel, CallRow, WaitRow, StuckRow, WaitKind, Books } from '@/lib/command/commandCenter';
import { SOURCE_LABELS } from '@/lib/metrics/colors';
import { moneyShort } from '@/lib/metrics/format';
import {
  BG_CARD, BORDER_SOFT, CARD_SHADOW, FONT_BODY, FONT_HEAD, FONT_HEAD_FEATURE, FREE_GREEN, NUM_DISPLAY,
  TEXT_MUTED, TRACK_BEIGE, brandVar, scoreColor, MQ_DASH_DESKTOP,
} from '@/lib/theme';

// The owner's Command Center: one glanceable screen, phone first.
// Four cards: Call now, Waiting on you, On the books, Stuck.
//
// Visual-first rules (brand guide, client handouts): readable in 30 seconds,
// labels of 1-4 words, no sentences, big tap targets (48px call buttons,
// 60px rows). Soft palette: slate and ink text, the tenant's brand color
// (Auto Mate orange by default) as the one accent. Every call button is a
// plain tel: link; nothing on this screen sends anything.
//
// Pure layout over a CommandModel (lib/command/commandCenter.ts). No hooks,
// so it renders from the server page as-is.

const INK = '#2f3a44';
const SLATE = '#3d4852';
const STONE = '#f6f3f0';

const EXTRA_LABELS: Record<string, string> = { typed: 'Typed in', lead_snapshot: 'Photo', meta: 'Meta' };
const sourceLabel = (s: string) => EXTRA_LABELS[s] ?? SOURCE_LABELS[s] ?? s.replaceAll('_', ' ');

function Section({ title, icon, count, area, incomplete = false, children }: {
  title: string; icon: ReactNode; count?: number; area: string; incomplete?: boolean; children: ReactNode;
}) {
  return (
    <section className={`cc-${area}`} style={{
      background: BG_CARD, borderRadius: 20, padding: 16, boxShadow: CARD_SHADOW,
      border: `1px solid ${BORDER_SOFT}`, minWidth: 0,
    }}>
      <h2 style={{
        display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px',
        fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, letterSpacing: 1.6,
        textTransform: 'uppercase', color: SLATE,
      }}>
        <span aria-hidden style={{ display: 'inline-flex', color: brandVar }}>{icon}</span>
        {title}
        {count != null && count > 0 && (
          <span style={{
            marginLeft: 'auto', minWidth: 24, height: 24, padding: '0 7px', borderRadius: 12,
            background: STONE, color: INK, fontSize: 13, letterSpacing: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        )}
      </h2>
      {children}
      {/* A read that hit its page ceiling (or failed) is said out loud, never
          passed off as the whole list. */}
      {incomplete && (
        <div data-testid={`incomplete-${area}`} style={{ fontFamily: FONT_BODY, fontSize: 12, color: TEXT_MUTED, marginTop: 8 }}>
          Some not shown
        </div>
      )}
    </section>
  );
}

function CallButton({ tel, name, demo }: { tel: string | null; name: string; demo: boolean }) {
  const style: React.CSSProperties = {
    width: 48, height: 48, borderRadius: 24, flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: brandVar, color: '#fff', textDecoration: 'none',
  };
  // Demo dashboards are read-only and their numbers are not real people's:
  // the button shows, it just does not dial. A number that is not a plain US
  // number gets no button at all.
  if (!tel) return <span aria-hidden style={{ width: 48, flexShrink: 0 }} />;
  if (demo) {
    return (
      <span data-testid="call-disabled" role="img" aria-label={`Call ${name} (off in the demo)`} style={{ ...style, opacity: 0.35 }}>
        <Phone size={22} weight="fill" aria-hidden />
      </span>
    );
  }
  return (
    <a href={tel} aria-label={`Call ${name}`} style={style}>
      <Phone size={22} weight="fill" aria-hidden />
    </a>
  );
}

function Row({ href, lead, children, tel, name, demo }: {
  href: string; lead: ReactNode; children: ReactNode; tel: string | null; name: string; demo: boolean;
}) {
  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 10, minHeight: 60,
      borderTop: `1px solid ${BORDER_SOFT}`, padding: '6px 0',
    }}>
      <Link href={href} style={{
        display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0,
        color: 'inherit', textDecoration: 'none', minHeight: 48,
      }}>
        {lead}
        <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
      </Link>
      <CallButton tel={tel} name={name} demo={demo} />
    </li>
  );
}

const nameStyle: React.CSSProperties = {
  fontFamily: FONT_BODY, fontWeight: 600, fontSize: 16, color: INK,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const subStyle: React.CSSProperties = { fontFamily: FONT_BODY, fontSize: 13, color: TEXT_MUTED, marginTop: 2 };

function ScoreBadge({ score }: { score: number }) {
  const c = scoreColor(score);
  return (
    <span aria-label={`Score ${score}`} style={{
      ...NUM_DISPLAY, fontWeight: 400, fontSize: 18, color: c,
      width: 46, height: 46, borderRadius: 23, flexShrink: 0, border: `3px solid ${c}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{score}</span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: INK, background: STONE,
      padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function CallRowView({ r, demo }: { r: CallRow; demo: boolean }) {
  return (
    <Row href={r.href} tel={r.tel} name={r.name} demo={demo} lead={<ScoreBadge score={r.score} />}>
      <div style={nameStyle}>{r.name}</div>
      {r.reasons.length > 0
        ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{r.reasons.map(x => <Chip key={x}>{x}</Chip>)}</div>
        : r.detail ? <div style={subStyle}>{r.detail}</div> : null}
    </Row>
  );
}

const WAIT_META: Record<WaitKind, { label: string; icon: ReactNode; tint: string }> = {
  handed: { label: 'Handed off', icon: <UserSwitch size={20} weight="bold" />, tint: brandVar },
  replied: { label: 'Replied', icon: <ChatCircleDots size={20} weight="bold" />, tint: SLATE },
  new: { label: 'New', icon: <Sparkle size={20} weight="bold" />, tint: FREE_GREEN },
};
const WAIT_KINDS: WaitKind[] = ['handed', 'replied', 'new'];

function KindDot({ kind }: { kind: WaitKind }) {
  const m = WAIT_META[kind];
  return (
    <span aria-hidden style={{
      width: 40, height: 40, borderRadius: 20, flexShrink: 0, color: m.tint,
      background: `color-mix(in srgb, ${m.tint} 12%, white)`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{m.icon}</span>
  );
}

function WaitRowView({ r, demo }: { r: WaitRow; demo: boolean }) {
  return (
    <Row href={r.href} tel={r.tel} name={r.name} demo={demo} lead={<KindDot kind={r.kind} />}>
      <div style={nameStyle}>{r.name}</div>
      <div style={subStyle}>{WAIT_META[r.kind].label} · {r.when}</div>
    </Row>
  );
}

function StuckRowView({ r, demo }: { r: StuckRow; demo: boolean }) {
  const owed = r.kind === 'owed';
  const tint = owed ? brandVar : SLATE;
  return (
    <Row href={r.href} tel={r.tel} name={r.name} demo={demo} lead={
      <span aria-hidden style={{
        width: 40, height: 40, borderRadius: 20, flexShrink: 0, color: tint,
        background: `color-mix(in srgb, ${tint} 12%, white)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{owed ? <CurrencyDollar size={20} weight="bold" /> : <HourglassMedium size={20} weight="bold" />}</span>
    }>
      <div style={nameStyle}>{r.name}</div>
      <div style={{ ...subStyle, color: owed ? INK : TEXT_MUTED, fontWeight: owed ? 600 : 400 }}>{r.label}</div>
    </Row>
  );
}

function More({ n, href }: { n: number; href: string }) {
  if (n <= 0) return null;
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44,
      fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: SLATE, textDecoration: 'none',
      borderTop: `1px solid ${BORDER_SOFT}`,
    }}>+{n} more <CaretRight size={14} weight="bold" aria-hidden /></Link>
  );
}

function Empty({ children, ok = false }: { children: ReactNode; ok?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, minHeight: 48,
      fontFamily: FONT_BODY, fontSize: 15, color: ok ? FREE_GREEN : TEXT_MUTED, fontWeight: ok ? 600 : 400,
    }}>
      {ok && <CheckCircle size={22} weight="fill" aria-hidden />}
      {children}
    </div>
  );
}

const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

function Stat({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: STONE, borderRadius: 14, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: SLATE }}>{label}</div>
      <div style={{ ...NUM_DISPLAY, fontSize: 28, color, marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function BooksView({ books, pipelineHref }: { books: Books; pipelineHref: string }) {
  // Every source with a lead, most cash first. J&C has a handful, so the
  // whole list fits; the "+N more" pattern would hide where money came from.
  const top = books.sources;
  const max = Math.max(1, ...top.map(s => s.collectedCents));
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Stat label="Won" value={String(books.won)} />
        <Stat label="Sold" value={moneyShort(books.soldCents)} />
        <Stat label="Collected" value={moneyShort(books.collectedCents)} color={books.collectedCents > 0 ? FREE_GREEN : INK} />
        <Stat
          label="To collect"
          value={books.owedCents == null ? '-' : moneyShort(books.owedCents)}
          color={books.owedCents ? brandVar : INK}
        />
      </div>

      {!books.hasOutcomes && (
        <Link href={pipelineHref} style={{
          display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, marginTop: 6,
          fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: brandVar, textDecoration: 'none',
        }}>Mark jobs won <CaretRight size={14} weight="bold" aria-hidden /></Link>
      )}

      {top.length > 0 && (
        <div data-testid="books-sources" style={{ marginTop: 14 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, letterSpacing: 1.6, color: SLATE, textTransform: 'uppercase',
          }}>
            By source
            {books.metaReturn != null && <Chip>Meta ads {books.metaReturn.toFixed(1)}x</Chip>}
          </div>
          {top.map((s, i) => (
            <div key={s.source} data-testid={`source-${s.source}`} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontFamily: FONT_BODY }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{sourceLabel(s.source)}</span>
                <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                  {s.won}/{s.leads} won · <b style={{ color: INK }}>{moneyShort(s.collectedCents)}</b>
                </span>
              </div>
              <div aria-hidden style={{ height: 8, borderRadius: 4, background: TRACK_BEIGE, marginTop: 5, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, width: `${Math.round((s.collectedCents / max) * 100)}%`,
                  background: i === 0 && s.collectedCents > 0 ? brandVar : SLATE,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function CommandCenter({ model, today, demo }: { model: CommandModel; today: string; demo: boolean }) {
  const { call, waiting, stuck, books } = model;
  const waitTotal = waiting.counts.handed + waiting.counts.replied + waiting.counts.new;
  return (
    <div data-testid="command-center" style={{ fontFamily: FONT_BODY, color: INK }}>
      <style>{`
        .cc-grid { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
        ${MQ_DASH_DESKTOP} {
          .cc-grid {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr);
            grid-template-areas: "call wait books" "stuck wait books";
            align-items: start;
          }
          .cc-call { grid-area: call; }
          .cc-wait { grid-area: wait; }
          .cc-books { grid-area: books; }
          .cc-stuck { grid-area: stuck; }
        }
      `}</style>

      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '12px 2px 12px' }}>
        <h1 style={{ margin: 0, fontFamily: FONT_HEAD, fontFeatureSettings: FONT_HEAD_FEATURE, fontWeight: 400, fontSize: 28, color: INK }}>
          Today
        </h1>
        <span style={{ fontSize: 14, color: TEXT_MUTED }}>{today}</span>
      </header>

      <div className="cc-grid">
        <Section area="call" title="Call now" icon={<Fire size={18} weight="fill" />} incomplete={model.incomplete.call}>
          {call.length === 0
            ? <Empty>{model.scored ? 'Nobody to call' : 'Scoring not on yet'}</Empty>
            : <ul style={listStyle}>{call.map(r => <CallRowView key={r.id} r={r} demo={demo} />)}</ul>}
        </Section>

        <Section area="wait" title="Waiting on you" icon={<ChatCircleDots size={18} weight="fill" />} count={waitTotal} incomplete={model.incomplete.waiting}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 6 }}>
            {WAIT_KINDS.map(k => (
              <div key={k} data-testid={`wait-count-${k}`} style={{ background: STONE, borderRadius: 14, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: WAIT_META[k].tint }}>
                  <span aria-hidden style={{ display: 'inline-flex' }}>{WAIT_META[k].icon}</span>
                  <span style={{ ...NUM_DISPLAY, fontSize: 26, color: INK }}>{waiting.counts[k]}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: SLATE, marginTop: 2, whiteSpace: 'nowrap' }}>{WAIT_META[k].label}</div>
              </div>
            ))}
          </div>
          {waiting.rows.length === 0
            ? <Empty ok>All caught up</Empty>
            : <ul style={listStyle}>{waiting.rows.map(r => <WaitRowView key={r.id} r={r} demo={demo} />)}</ul>}
          <More n={waiting.more} href={model.pipelineHref} />
        </Section>

        <Section area="books" title="On the books" icon={<CurrencyDollar size={18} weight="bold" />} incomplete={model.incomplete.books}>
          {books ? <BooksView books={books} pipelineHref={model.pipelineHref} /> : <Empty>Not set up yet</Empty>}
        </Section>

        <Section area="stuck" title="Stuck" icon={<HourglassMedium size={18} weight="fill" />} count={stuck.rows.length + stuck.more} incomplete={model.incomplete.stuck}>
          {stuck.rows.length === 0
            ? <Empty ok>Nothing stuck</Empty>
            : <ul style={listStyle}>{stuck.rows.map(r => <StuckRowView key={r.id} r={r} demo={demo} />)}</ul>}
          <More n={stuck.more} href={model.pipelineHref} />
        </Section>
      </div>
    </div>
  );
}

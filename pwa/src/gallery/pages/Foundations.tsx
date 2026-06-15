import './Foundations.css'

/* Visual catalog of Layer-1 tokens so they can be judged rendered, in both
   light and dark, before any component is built on them. Everything here reads
   from CSS variables — it IS the token layer, not a copy of it. */

export function Foundations() {
  return (
    <div className="fdn">
      <header className="fdn__intro">
        <h1>Foundations</h1>
        <p className="fdn__lede">
          Layer 1 — the global tweak surface. Every value below lives in{' '}
          <code>src/styles/tokens.css</code>. Toggle Theme (top-right) to see
          light/dark. Tell me what to change and it ripples to every component.
        </p>
      </header>

      <Section title="Surfaces & text" note="Background layers and text emphasis levels.">
        <div className="fdn__surfaces">
          <Surface name="--bg" />
          <Surface name="--bg-elevated" />
          <Surface name="--bg-sunken" />
          <Surface name="--bg-hover" />
          <Surface name="--bg-active" />
        </div>
        <div className="fdn__textrow">
          <span style={{ color: 'var(--text)' }}>Primary text</span>
          <span style={{ color: 'var(--text-secondary)' }}>Secondary text</span>
          <span style={{ color: 'var(--text-muted)' }}>Muted text</span>
          <span style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>On accent</span>
        </div>
      </Section>

      <Section title="Brand & feedback" note="Accent drives primary actions; feedback hues are reserved for meaning.">
        <div className="fdn__swatches">
          <Swatch name="--accent" />
          <Swatch name="--accent-hover" />
          <Swatch name="--accent-quiet" dark />
          <Swatch name="--success" />
          <Swatch name="--warning" />
          <Swatch name="--danger" />
        </div>
      </Section>

      <Section
        title="Filter chips — tri-state"
        note="The three-tap include / exclude / clear model (browse.md). Include=green, exclude=red, default=outline. Distinct from the brand accent on purpose."
      >
        <div className="fdn__chips">
          <span className="demo-chip">Slow Burn</span>
          <span className="demo-chip demo-chip--inc">Slow Burn</span>
          <span className="demo-chip demo-chip--exc">Slow Burn</span>
        </div>
        <div className="fdn__caption">default · include · exclude</div>
      </Section>

      <Section
        title="Status & favorite"
        note="read_status = Unread | Read | DNF (redesign §8). Favorite ★ is orthogonal (is_favorite), not a status."
      >
        <div className="fdn__statusrow">
          <Badge color="var(--status-unread)" label="Unread" />
          <Badge color="var(--status-read)" label="Read" />
          <Badge color="var(--status-dnf)" label="DNF" />
          <span className="fdn__fav">★ <span>Favorite</span></span>
        </div>
      </Section>

      <Section title="AO3 rating" note="Mirrors AO3's own colors so they read as familiar.">
        <div className="fdn__statusrow">
          <Badge color="var(--rating-general)" label="General" />
          <Badge color="var(--rating-teen)" label="Teen" />
          <Badge color="var(--rating-mature)" label="Mature" />
          <Badge color="var(--rating-explicit)" label="Explicit" />
          <Badge color="var(--rating-notrated)" label="Not Rated" />
        </div>
      </Section>

      <Section title="Worker heartbeat" note="Sync view online/stale/offline (§12.4).">
        <div className="fdn__statusrow">
          <Dot color="var(--heartbeat-online)" label="Online" />
          <Dot color="var(--heartbeat-stale)" label="Stale" />
          <Dot color="var(--heartbeat-offline)" label="Offline" />
        </div>
      </Section>

      <Section title="Type scale" note="System font stack (no web-font download — protects the Palma <2s cold start).">
        <div className="fdn__type">
          <Type token="--text-2xl" px="33" sample="Browse" />
          <Type token="--text-xl" px="26" sample="Reading Lists" />
          <Type token="--text-lg" px="20" sample="Section heading" />
          <Type token="--text-md" px="17" sample="Card title — Even in Arcadia" />
          <Type token="--text-base" px="15" sample="Body text and summaries." />
          <Type token="--text-sm" px="13" sample="Secondary / metadata row" />
          <Type token="--text-xs" px="11" sample="LABELS · COUNTS · 12.4k words" />
        </div>
        <div className="fdn__reading">
          <span className="fdn__caption">Reading serif (in-app reader / summaries):</span>
          <p style={{ fontFamily: 'var(--font-reading)', fontSize: 'var(--text-md)', lineHeight: 'var(--leading-relaxed)', marginTop: 4 }}>
            The rain had not stopped for three days, and Steve had begun to suspect it never would.
          </p>
        </div>
      </Section>

      <Section title="Spacing scale" note="4px base. Used for padding, gaps, layout rhythm.">
        <div className="fdn__spacing">
          {(['--space-1','--space-2','--space-3','--space-4','--space-5','--space-6','--space-7','--space-8'] as const).map((t) => (
            <div key={t} className="fdn__spaceitem">
              <div className="fdn__spacebar" style={{ width: `var(${t})` }} />
              <code>{t}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii & elevation" note="Corner rounding and shadow depth.">
        <div className="fdn__radii">
          {(['--radius-sm','--radius-md','--radius-lg','--radius-pill'] as const).map((t) => (
            <div key={t} className="fdn__radbox" style={{ borderRadius: `var(${t})` }}><code>{t}</code></div>
          ))}
        </div>
        <div className="fdn__elev">
          {(['--shadow-sm','--shadow-md','--shadow-lg'] as const).map((t) => (
            <div key={t} className="fdn__elevbox" style={{ boxShadow: `var(${t})` }}><code>{t}</code></div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="fdn__section">
      <h2 className="fdn__h2">{title}</h2>
      {note && <p className="fdn__note">{note}</p>}
      <div className="fdn__sectionbody">{children}</div>
    </section>
  )
}

function Surface({ name }: { name: string }) {
  return (
    <div className="fdn__surface" style={{ background: `var(${name})` }}>
      <code>{name}</code>
    </div>
  )
}

function Swatch({ name, dark }: { name: string; dark?: boolean }) {
  return (
    <div className="fdn__swatch">
      <div className="fdn__swatchcolor" style={{ background: `var(${name})` }} />
      <code style={{ color: dark ? 'var(--text)' : undefined }}>{name}</code>
    </div>
  )
}

function Badge({ color, label }: { color: string; label: string }) {
  return <span className="demo-badge" style={{ background: color }}>{label}</span>
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="fdn__dot">
      <span className="fdn__dotcircle" style={{ background: color }} />
      {label}
    </span>
  )
}

function Type({ token, px, sample }: { token: string; px: string; sample: string }) {
  return (
    <div className="fdn__typerow">
      <code className="fdn__typetoken">{token} · {px}px</code>
      <span style={{ fontSize: `var(${token})` }}>{sample}</span>
    </div>
  )
}

'use client';

/**
 * Manage social → Employees.
 *
 * The team. Hire someone, give them a name, and from that moment they do the
 * job their role covers — on every run, without being asked again. Nobody is
 * built in: an empty office makes nothing, one writer makes scripts and no
 * pictures, and two designers share the drawing between them.
 *
 * Three things this page deliberately makes visible:
 *
 * - **What the roster cannot do**, in words, before it costs you a bad piece.
 *   "No video editor — reels will stop at the script" is worth knowing on
 *   Monday, not in the approval queue on Friday.
 * - **Who is idle**, because a job nobody holds is silently skipped.
 * - **The difference between a rule and a note.** Standing instructions apply
 *   to everyone forever; direction on a person applies to them and leaves when
 *   they do; feedback in the queue applies to one piece.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useWorkspace } from '@/lib/workspace';
import { colors } from '@/lib/config';
import {
  SOCIAL_ROLES,
  socialApi,
  type SocialBrief,
  type SocialCompetitor,
  type SocialEmployee,
  type SocialPostDoc,
  type SocialReadiness,
  type SocialRole,
  type SocialSettings,
} from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { Mascot, ROLE_META, StatusPill } from '@/components/social/shared';
import { Office, officeLive } from '@/components/social/office';

export default function EmployeesPage() {
  const { path } = useWorkspace();
  const [staff, setStaff] = useState<SocialEmployee[]>([]);
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [coverage, setCoverage] = useState<string[]>([]);
  /**
   * Which engine is actually running. This page holds the one model box, and
   * the box is shared by every engine — so without this it cannot tell the
   * difference between an id that is being used and one that is being ignored,
   * and it used to assert the second about both.
   */
  const [engine, setEngine] = useState<SocialReadiness['engine'] | null>(null);
  const [draft, setDraft] = useState<Partial<SocialSettings>>({});
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, path('socialEmployees')),
        (snap) =>
          setStaff(
            snap.docs
              .map((d) => ({ ...(d.data() as SocialEmployee), id: d.id }))
              .sort((a, b) => a.hiredAtMs - b.hiredAtMs),
          ),
        (e) => setError(e.message),
      ),
    [path],
  );

  // The office reads the same work log the queue draws: whoever holds a stage
  // that is running right now is the person lit up at the table.
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, path('socialPosts')), orderBy('date', 'desc'), limit(6)),
        (snap) => setPosts(snap.docs.map((d) => ({ ...(d.data() as SocialPostDoc), id: d.id }))),
        () => setPosts([]),
      ),
    [path],
  );

  const { live, running } = useMemo(() => officeLive(posts), [posts]);

  const loadSettings = () =>
    socialApi
      .getSettings({})
      .then((r) => {
        setSettings(r.settings);
        setCoverage(r.coverage);
        setEngine(r.readiness.engine);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not read the settings.'));

  useEffect(() => {
    void loadSettings();
  }, []);

  const value = <K extends keyof SocialSettings>(key: K): SocialSettings[K] | undefined =>
    (draft[key] ?? settings?.[key]) as SocialSettings[K] | undefined;

  const set = <K extends keyof SocialSettings>(key: K, v: SocialSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const brief = (key: keyof SocialBrief): string =>
    (draft.brief?.[key] ?? settings?.brief?.[key] ?? '') as string;

  /** The brief is one object, so a change to one box has to keep the other four. */
  const setBrief = (key: keyof SocialBrief, v: string) =>
    setDraft((d) => ({
      ...d,
      brief: {
        about: '',
        posts: '',
        viral: '',
        comments: '',
        avoid: '',
        ...(settings?.brief ?? {}),
        ...(d.brief ?? {}),
        [key]: v,
      },
    }));

  async function run(label: string, fn: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
      await loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const saveSettings = () =>
    run('settings', async () => {
      if (!Object.keys(draft).length) return null;
      const res = await socialApi.updateSettings(draft);
      setSettings(res.settings);
      setDraft({});
      return 'Saved. Everyone reads this on their next job.';
    });

  const seed = () =>
    run('seed', async () => {
      const res = await socialApi.seedTeam({});
      return res.hired
        ? `Hired ${res.hired} ${res.hired === 1 ? 'person' : 'people'}. Rename anybody you like.`
        : 'Every role is already filled.';
    });

  const active = staff.filter((e) => e.status === 'active');
  const filled = useMemo(() => new Set(active.map((e) => e.role)), [active]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Employees</h1>
        <p style={{ color: colors.muted, margin: 0 }}>
          Everyone who works on Velocity Rides’ social content. Hire them, name them, brief them — and whoever is on the
          team does their job on every run.
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {/* the same team, as a room */}
      <Office staff={staff} live={live} running={running} />

      {staff.length === 0 ? (
        <Card>
          <h2 style={{ ...h2, marginBottom: 6 }}>Nobody works here yet</h2>
          <p style={{ fontSize: 13.5, color: colors.muted, margin: '0 0 12px', lineHeight: 1.55 }}>
            The desk makes nothing until somebody is hired. Start one at a time below, or take a full team and rename
            them afterwards — a content writer alone is enough to see a piece written.
          </p>
          <Button onClick={seed} disabled={!!busy}>
            {busy === 'seed' ? 'Hiring…' : 'Hire one of each'}
          </Button>
        </Card>
      ) : null}

      {coverage.length ? (
        <Card>
          <h2 style={h2}>What this team cannot do</h2>
          <div style={{ display: 'grid', gap: 7 }}>
            {coverage.map((gap) => (
              <div key={gap} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: '#fab219',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 900,
                    flex: 'none',
                    marginTop: 2,
                  }}
                >
                  !
                </span>
                <span style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.45 }}>{gap}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : staff.length ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: colors.success, fontWeight: 700 }}>
            Every job is covered. Nothing on a piece will be skipped for want of a person.
          </p>
        </Card>
      ) : null}

      {/* the roster */}
      {staff.length ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))' }}>
          {staff.map((employee) => (
            <EmployeeCard key={employee.id} employee={employee} onDone={loadSettings} />
          ))}
        </div>
      ) : null}

      <HireCard filled={filled} onDone={loadSettings} />

      {/* the long brief — said once, read on every job */}
      <Card>
        <h2 style={{ ...h2, marginBottom: 4 }}>Brief the team</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
          What you would tell somebody on their first day, written once and read on <strong>every job,
          forever</strong>. Say as much as you want — a paragraph here that stops one bad post a day is the
          cheapest thing on this desk. Each box goes to the people it is for, so the inbox is not reading your
          rules about reels and the designer is not reading your rules about complaints.
        </p>

        <div style={{ display: 'grid', gap: 16 }}>
          <BriefBox
            label="Who we are"
            who="Everyone"
            hint="The business, the people, the story, what you are actually trying to build. The context a new hire would be missing."
            placeholder={
              'e.g. We started Velocity because surge pricing made a Gulberg to Johar Town ride cost 900 rupees on a rainy evening. Our drivers are not gig workers to us; most of them we have met. We are small and we do not pretend otherwise...'
            }
            value={brief('about')}
            onChange={(v) => setBrief('about', v)}
          />
          <BriefBox
            label="What I want from a post"
            who="Planning, writer, designer, video editor"
            hint="What a good one looks like to you, and what a bad one looks like. Be specific — examples beat adjectives."
            placeholder={
              'e.g. I want real drivers with their names, not models. Show the cash in hand. Every post should answer one question a rider actually asks. Urdu in the voiceover, English on screen...'
            }
            value={brief('posts')}
            onChange={(v) => setBrief('posts', v)}
          />
          <BriefBox
            label="What viral means to me"
            who="Planning, writer, research desk, SEO"
            hint="Everyone says they want viral. Say what you mean: who sends it to whom, and why."
            placeholder={
              'e.g. A driver sends it to his WhatsApp group of other drivers. A woman sends it to her sister because of the female-driver option. If nobody would forward it, it is not the post I want...'
            }
            value={brief('viral')}
            onChange={(v) => setBrief('viral', v)}
          />
          <BriefBox
            label="How to answer people"
            who="The social manager and the comment inbox"
            hint="Tone, what to promise, what to escalate, what never to argue about."
            placeholder={
              'e.g. Reply in whatever language they wrote in. Never defend a fare. If somebody is angry, apologise once and give them support, do not explain the policy...'
            }
            value={brief('comments')}
            onChange={(v) => setBrief('comments', v)}
          />
          <BriefBox
            label="Never"
            who="Everyone, as a rule"
            hint="The things that must not happen, whatever else anyone is told. These outrank the rest of this page."
            placeholder={
              'e.g. Never show a driver without a seatbelt. Never promise an income. Never use a photo of a car we do not have. Never post about a competitor, even to disagree...'
            }
            value={brief('avoid')}
            onChange={(v) => setBrief('avoid', v)}
          />
        </div>
      </Card>

      {/* what everyone reads */}
      <Card>
        <h2 style={{ ...h2, marginBottom: 4 }}>Standing instructions</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 10px', lineHeight: 1.5 }}>
          The short note box, read by <strong>everyone</strong> on every job. This month’s promotion, a word you
          never want to see again, the thing that changed this week. The brief above is who we are and stays put;
          this is what is true right now. Direction for one person goes on their card; a note about one piece goes
          in the approval queue.
        </p>
        <textarea
          value={(value('crewInstructions') as string) ?? ''}
          onChange={(e) => set('crewInstructions', e.target.value)}
          rows={7}
          placeholder={
            'e.g.\n- We are recruiting drivers in Lahore this month. Bias towards driver-side stories.\n- Never say "cheapest". Say the rider names the fare.\n- Always show a real Pakistani street, never a generic city.\n- Urdu in the voiceover, English on screen.'
          }
          style={{ ...inputStyle, lineHeight: 1.55, resize: 'vertical' }}
        />
      </Card>

      {/* research inputs */}
      <Card>
        <h2 style={{ ...h2, marginBottom: 4 }}>What the research desk reads</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
          Once a day, whoever covers research searches for what is travelling in this market and what these apps are
          publishing, and brings it to standup. Everyone is barred from naming any of them in a post — this is for
          reading the room, not for copying anyone.
        </p>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={(value('researchEnabled') as boolean) ?? true}
            onChange={(e) => set('researchEnabled', e.target.checked)}
          />
          <span style={{ fontWeight: 700 }}>Search the market before writing</span>
        </label>

        <div style={{ display: 'grid', gap: 8 }}>
          {((value('competitors') ?? []) as SocialCompetitor[]).map((competitor, i) => {
            const list = (value('competitors') ?? []) as SocialCompetitor[];
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={competitor.name}
                  onChange={(e) => {
                    const next = [...list];
                    next[i] = { ...competitor, name: e.target.value };
                    set('competitors', next);
                  }}
                  placeholder="Name"
                  style={{ ...inputStyle, width: 150 }}
                />
                <input
                  value={competitor.url}
                  onChange={(e) => {
                    const next = [...list];
                    next[i] = { ...competitor, url: e.target.value };
                    set('competitors', next);
                  }}
                  placeholder="https://…"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  value={competitor.instagram ?? ''}
                  onChange={(e) => {
                    const next = [...list];
                    next[i] = { ...competitor, instagram: e.target.value.trim().replace(/^@/, '') };
                    set('competitors', next);
                  }}
                  placeholder="@instagram"
                  aria-label={`${competitor.name || 'Competitor'} on Instagram`}
                  style={{ ...inputStyle, width: 140 }}
                />
                <Button variant="ghost" onClick={() => set('competitors', list.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            );
          })}
          <div>
            <Button
              variant="ghost"
              onClick={() =>
                set('competitors', [...((value('competitors') ?? []) as SocialCompetitor[]), { name: '', url: '' }])
              }
            >
              Add another
            </Button>
          </div>
        </div>
      </Card>

      {/* the tools they work with */}
      <Card>
        <h2 style={{ ...h2, marginBottom: 4 }}>The tools</h2>
        <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
          Everyone thinks and writes with whichever engine this deployment has, in one order:{' '}
          <strong>Claude</strong> (<code>ANTHROPIC_API_KEY</code>, the only paid one), then{' '}
          <strong>Gemini’s free tier</strong> (<code>GEMINI_KEY_RESEARCH</code> — the only free one that can also
          search, so the only free one with a live market read), then any <strong>OpenAI-compatible free model</strong>{' '}
          (<code>FREE_MODEL_KEY</code>), then the <strong>local engine</strong>, which needs no key at all and composes
          from the brand material, scoring every candidate against the same checks: no cost, no failed runs, and
          plainer writing.{' '}
          {engine ? (
            <>
              Right now it is{' '}
              <strong>
                {engine === 'claude'
                  ? 'Claude'
                  : engine === 'gemini'
                    ? 'Gemini’s free tier'
                    : engine === 'free'
                      ? 'the free model'
                      : 'the local engine'}
              </strong>
              .{' '}
            </>
          ) : null}
          The desk makes the pictures and the reels itself from the script; upload your own in the queue whenever you
          prefer. The model id is editable because model names change; when one does, this is the fix, not a redeploy.
        </p>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field
            label="Writing and thinking"
            hint="Planning, research, writing, SEO, ads, captions and replies. A model id belonging to the engine that is running."
          >
            <input
              value={(value('textModel') as string) ?? ''}
              onChange={(e) => set('textModel', e.target.value)}
              style={inputStyle}
            />
            {/* An id belonging to another engine is corrected by the backend
                rather than sent to an API that would refuse it — but a field
                showing a value nobody is using is its own kind of lie. */}
            {modelNoteFor(engine, (value('textModel') as string) ?? '') ? (
              <p style={{ fontSize: 11.5, color: colors.warn, margin: '6px 0 0', lineHeight: 1.45 }}>
                {modelNoteFor(engine, (value('textModel') as string) ?? '')}
              </p>
            ) : null}
          </Field>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button onClick={saveSettings} disabled={!!busy || !Object.keys(draft).length}>
          {busy === 'settings' ? 'Saving…' : 'Save'}
        </Button>
        {Object.keys(draft).length ? (
          <span style={{ fontSize: 12.5, color: colors.warn }}>Unsaved changes.</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What to say under the model box, if anything.
 *
 * One box, four engines. The backend corrects an id belonging to a different
 * engine rather than forwarding it to an API that would refuse it, so nothing
 * breaks — but then the field is showing a value nobody is using, and saying so
 * is cheaper than letting somebody tune a model that is not running.
 *
 * Returns null when the id is the running engine's own and is being used as
 * typed.
 */
function modelNoteFor(engine: SocialReadiness['engine'] | null, configured: string): string | null {
  const model = configured.trim();
  if (!engine || !model) return null;
  const claude = model.startsWith('claude-');
  const gemini = model.startsWith('gemini-');

  if (engine === 'local') {
    return 'No model key is set, so nothing reads this box — the local engine writes without one.';
  }
  if (engine === 'claude') {
    return claude ? null : 'Not a Claude model, and Claude is what is running — the team is writing with claude-opus-5 instead.';
  }
  if (engine === 'gemini') {
    if (!gemini) return 'Not a Gemini model, and Gemini is what is running — the team is writing with gemini-2.5-flash instead.';
    // Free grounding exists on 2.5 Flash alone, so the morning market read is
    // pinned there whatever is typed here. Worth one line: it is the one value
    // in this box that is overridden rather than corrected.
    return model === 'gemini-2.5-flash'
      ? null
      : 'The writing uses this model; the morning market read stays on gemini-2.5-flash, the only one whose Google Search grounding is free.';
  }
  return claude || gemini
    ? 'Belongs to another engine — the free model is using its own default instead.'
    : null;
}

/** One person: who they are, what they are for, and what they have done. */
function EmployeeCard({ employee, onDone }: { employee: SocialEmployee; onDone: () => void }) {
  const [name, setName] = useState(employee.name);
  const [title, setTitle] = useState(employee.title);
  const [instructions, setInstructions] = useState(employee.instructions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adjusted during render rather than in an effect, so a live snapshot never
  // wipes what somebody is typing, but a change from elsewhere still lands.
  const server = `${employee.name}|${employee.title}|${employee.instructions}`;
  const [lastServer, setLastServer] = useState(server);
  if (server !== lastServer) {
    setLastServer(server);
    setName(employee.name);
    setTitle(employee.title);
    setInstructions(employee.instructions);
  }

  const dirty =
    name !== employee.name || title !== employee.title || instructions !== employee.instructions;

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const meta = ROLE_META[employee.role];

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
        <Mascot role={employee.role} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              ...inputStyle,
              fontSize: 16,
              fontWeight: 900,
              padding: '4px 6px',
              border: '1px solid transparent',
              background: 'transparent',
            }}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              ...inputStyle,
              fontSize: 12,
              fontWeight: 700,
              color: colors.muted,
              padding: '2px 6px',
              border: '1px solid transparent',
              background: 'transparent',
            }}
          />
        </div>
        <StatusPill status={employee.status} />
      </div>

      <p style={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.5, margin: '0 0 10px' }}>{meta.does}</p>

      <div style={{ fontSize: 11.5, color: colors.muted, marginBottom: 10 }}>
        {employee.piecesWorked > 0
          ? `${employee.piecesWorked} job${employee.piecesWorked === 1 ? '' : 's'} done`
          : 'No jobs yet'}
        {employee.lastWorkedAtMs
          ? ` · last worked ${new Date(employee.lastWorkedAtMs).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
            })}`
          : ''}
      </div>

      <label style={{ fontSize: 11, fontWeight: 800, color: colors.muted }}>
        DIRECTION FOR {employee.name.toUpperCase()} ONLY
      </label>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        placeholder={PLACEHOLDER[employee.role]}
        style={{ ...inputStyle, marginTop: 4, fontSize: 12.5, resize: 'vertical' }}
      />

      {error ? <p style={{ color: colors.danger, fontSize: 12.5, margin: '8px 0 0' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          onClick={() =>
            act('save', async () => {
              await socialApi.updateEmployee({ id: employee.id, name, title, instructions });
            })
          }
          disabled={!dirty || !!busy}
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            act('status', async () => {
              await socialApi.updateEmployee({
                id: employee.id,
                status: employee.status === 'active' ? 'off_duty' : 'active',
              });
            })
          }
          disabled={!!busy}
        >
          {employee.status === 'active' ? 'Send off duty' : 'Bring back'}
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          variant="danger"
          onClick={() =>
            act('fire', async () => {
              if (!confirm(`Remove ${employee.name} from the team? Their name stays on everything they made.`)) {
                return;
              }
              await socialApi.fire({ id: employee.id });
            })
          }
          disabled={!!busy}
        >
          Remove
        </Button>
      </div>
    </Card>
  );
}

const PLACEHOLDER: Record<SocialRole, string> = {
  'research-assistant': 'e.g. watch what the bus and courier apps are doing too, not just ride-hailing',
  'content-writer': 'e.g. lead with drivers, not riders, until we have 500 cars',
  'seo-expert': 'e.g. we want to own “fare apni marzi ka” — work it in wherever it fits',
  'google-seo-expert': 'e.g. titles in Roman Urdu where the query is searched that way',
  designer: 'e.g. street light only, no studio shots, no stock smiles',
  'video-editor': 'e.g. keep it under 15 seconds and cut on the beat',
  'youtube-ads-expert': 'e.g. Lahore and Faisalabad only this quarter, PKR 3,000/day ceiling',
  'social-manager': 'e.g. never argue about prices in the comments — send them to support',
};

/** Hire somebody. Name first, because the name is what you will see everywhere. */
function HireCard({ filled, onDone }: { filled: Set<SocialRole>; onDone: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<SocialRole>('content-writer');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hire() {
    setBusy(true);
    setError(null);
    try {
      await socialApi.hire({ name: name.trim(), role, ...(title.trim() ? { title: title.trim() } : {}) });
      setName('');
      setTitle('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hire them.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ ...h2, marginBottom: 4 }}>Hire someone</h2>
      <p style={{ fontSize: 12.5, color: colors.muted, margin: '0 0 12px' }}>
        They start working on the next run. Hiring a second person into the same job is fine — the two share the work,
        whoever went longest without a job takes the next one.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 160px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 4 }}>NAME</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ayesha"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: '2 1 240px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 4 }}>JOB</div>
          <select value={role} onChange={(e) => setRole(e.target.value as SocialRole)} style={inputStyle}>
            {SOCIAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].label}
                {filled.has(r) ? ' (already on the team)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 4 }}>
            TITLE (OPTIONAL)
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={ROLE_META[role].label}
            style={inputStyle}
          />
        </div>
        <Button onClick={hire} disabled={busy || name.trim().length < 1}>
          {busy ? 'Hiring…' : 'Hire'}
        </Button>
      </div>

      <p style={{ fontSize: 12.5, color: colors.muted, margin: '10px 0 0', lineHeight: 1.5 }}>
        <strong style={{ color: colors.text }}>{ROLE_META[role].label}:</strong> {ROLE_META[role].does}
      </p>

      {error ? <p style={{ color: colors.danger, fontSize: 12.5, margin: '10px 0 0' }}>{error}</p> : null}
    </Card>
  );
}

const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: 0, marginBottom: 12 };

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
  background: colors.surface,
  color: colors.text,
};

/**
 * One box of the long brief.
 *
 * It names who reads it, because the commonest way a brief like this goes
 * wrong is somebody writing their rules for answering complaints into the box
 * the designer reads, and then wondering why nothing changed.
 */
function BriefBox({
  label,
  who,
  hint,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  who: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>{label}</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 800,
            color: colors.muted,
            border: `1px solid ${colors.border}`,
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          {who}
        </span>
      </div>
      <p style={{ fontSize: 12, color: colors.muted, margin: '3px 0 6px', lineHeight: 1.5 }}>{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={placeholder}
        style={{ ...inputStyle, lineHeight: 1.55, resize: 'vertical' }}
      />
      <div style={{ fontSize: 11, color: colors.muted, marginTop: 3, textAlign: 'right' }}>
        {value.length.toLocaleString()} / 6,000
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: colors.muted, marginBottom: 6 }}>{hint}</div>
      {children}
    </div>
  );
}

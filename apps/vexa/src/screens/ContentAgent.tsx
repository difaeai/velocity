import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CommentIcon,
  CopyIcon,
  DocPenIcon,
  EyeIcon,
  HeartIcon,
  ImageIcon,
  PencilIcon,
  PlayIcon,
  SparkleIcon,
  TrashIcon,
} from '../components/Icons';
import {
  Btn,
  Chips,
  Confirm,
  Empty,
  Field,
  IconBtn,
  Lede,
  LoadingBar,
  MarkRow,
  Page,
  PlatformMark,
  SectionTitle,
  Segment,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Tag,
  type Tone,
  useToast,
} from '../components/kit';
import { useAction, useLoad } from '../net';
import { writeCaption } from '../intent';
import {
  COST,
  commit,
  day,
  db,
  PLATFORMS,
  PLATFORM_NAME,
  prettyDay,
  record,
  uid,
  useDb,
  type Platform,
  type Post,
  type PostKind,
  type PostStatus,
} from '../store';
import { C, R } from '../theme';

type Filter = 'all' | 'approve' | 'scheduled' | 'posted' | 'draft';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'approve', label: 'To approve' },
  { key: 'scheduled', label: 'Queue' },
  { key: 'posted', label: 'Posted' },
  { key: 'draft', label: 'Drafts' },
];

const KINDS: Array<{ key: PostKind; label: string }> = [
  { key: 'reel', label: 'Reel' },
  { key: 'post', label: 'Photo' },
  { key: 'story', label: 'Story' },
];

const STATUS: Record<PostStatus, { text: string; tone: Tone }> = {
  draft: { text: 'Draft', tone: 'dim' },
  approve: { text: 'Needs you', tone: 'warn' },
  scheduled: { text: 'Scheduled', tone: 'lime' },
  posted: { text: 'Posted', tone: 'green' },
};

const TIMES = ['09:00', '13:00', '17:30', '19:30', '21:00'];


const blank = (): Post => ({
  id: '',
  title: '',
  caption: '',
  kind: 'reel',
  platforms: ['instagram'],
  day: day(0),
  time: '19:30',
  status: 'draft',
  hashtags: [],
});

export default function ContentAgent() {
  const data = useDb();
  const load = useLoad(900);
  const write = useAction();
  const save = useAction();
  const [toast, say] = useToast();

  const [filter, setFilter] = useState<Filter>('all');
  const [onDay, setOnDay] = useState<string | null>(null);
  const [edit, setEdit] = useState<Post | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tags, setTags] = useState('');
  const [err, setErr] = useState('');
  const [kill, setKill] = useState<Post | null>(null);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => day(i)), []);

  const rows = data.posts
    .filter((p) => (filter === 'all' ? true : p.status === filter))
    .filter((p) => (onDay ? p.day === onDay : true))
    .slice()
    .sort((a, b) => (a.day + a.time < b.day + b.time ? 1 : -1));

  const openNew = () => {
    setEdit(blank());
    setTags('');
    setIsNew(true);
    setErr('');
  };

  const openEdit = (p: Post) => {
    setEdit({ ...p });
    setTags(p.hashtags.join(' '));
    setIsNew(false);
    setErr('');
  };

  const set = <K extends keyof Post>(k: K, v: Post[K]) => setEdit((p) => (p ? { ...p, [k]: v } : p));

  const commitPost = () => {
    if (!edit) return;
    if (!edit.title.trim()) return setErr('Give it a name so you can find it later.');
    if (edit.platforms.length === 0) return setErr('Pick at least one account to post to.');

    save.run(1100, () => {
      const row: Post = {
        ...edit,
        id: edit.id || uid(),
        hashtags: tags.split(/\s+/).filter(Boolean),
      };
      if (isNew) data.posts.unshift(row);
      else {
        const i = data.posts.findIndex((p) => p.id === row.id);
        if (i >= 0) data.posts[i] = row;
      }
      commit();
      record({
        agent: 'Content',
        text: isNew
          ? `Wrote “${row.title}” for ${prettyDay(row.day)} at ${row.time}.`
          : `Changed “${row.title}”.`,
        credits: isNew ? (row.kind === 'reel' ? COST.reel : COST.post) : undefined,
        what: row.title,
      });
      setEdit(null);
      say(isNew ? 'Post added to the queue' : 'Changes saved');
    });
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={92}>
        <Lede text="Every reel, photo and story Vexa has written for you. Change any of it; she rewrites the rest around your change." />

        <SlowNote visible={load.slow} />

        {/* the week, with what sits on each day */}
        <Stagger>
          <Glass style={st.week} radius={R.lg}>
            <View style={st.weekInner}>
              {week.map((d) => {
                const n = data.posts.filter((p) => p.day === d).length;
                const live = onDay === d;
                return (
                  <Pressable key={d} style={st.dayCell} onPress={() => setOnDay(live ? null : d)}>
                    <Text style={[st.dayName, live && { color: C.lime }]}>
                      {new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
                    </Text>
                    <View style={[st.dayDisc, live && st.dayDiscOn, n > 0 && !live && st.dayDiscHas]}>
                      <Text style={[st.dayNo, live && { color: '#0A1206' }]}>{d.slice(8)}</Text>
                    </View>
                    <View style={st.dayDots}>
                      {Array.from({ length: Math.min(3, n) }, (_, i) => (
                        <View key={i} style={st.dayDot} />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Glass>
        </Stagger>

        <View style={{ marginTop: 12 }}>
          <Segment items={FILTERS} value={filter} onChange={setFilter} />
        </View>

        <SectionTitle
          text={onDay ? prettyDay(onDay).toUpperCase() : 'ALL CONTENT'}
          right={
            onDay ? (
              <Pressable onPress={() => setOnDay(null)}>
                <Text style={st.clear}>Clear day</Text>
              </Pressable>
            ) : (
              <Tag text={`${rows.length} pieces`} tone="lime" />
            )
          }
        />

        {load.loading ? (
          <SkeletonList rows={3} />
        ) : rows.length === 0 ? (
          <Empty
            icon={<DocPenIcon size={24} />}
            title="Nothing here yet"
            line="Add a piece yourself, or let Vexa fill the week from your last brief."
            cta="Write something"
            onCta={openNew}
          />
        ) : (
          rows.map((p, i) => (
            <Stagger key={p.id} index={i} style={{ marginBottom: 10 }}>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={p.status === 'approve'}>
                <View style={st.card}>
                  <View style={st.cardHead}>
                    <View style={st.thumb}>
                      {p.kind === 'reel' ? <PlayIcon size={18} /> : <ImageIcon size={18} color={C.green} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>{p.title}</Text>
                      <View style={st.cardMeta}>
                        <ClockIcon size={13} color={C.textDim} />
                        <Text style={st.cardMetaText}>
                          {prettyDay(p.day)} · {p.time}
                        </Text>
                        <MarkRow list={p.platforms} size={13} />
                      </View>
                    </View>
                    <Tag text={STATUS[p.status].text} tone={STATUS[p.status].tone} />
                  </View>

                  <Text style={st.caption} numberOfLines={2}>
                    {p.caption}
                  </Text>

                  {p.hashtags.length ? <Text style={st.tags}>{p.hashtags.join('  ')}</Text> : null}

                  {p.status === 'posted' ? (
                    <View style={st.metrics}>
                      <View style={st.metric}>
                        <EyeIcon size={15} />
                        <Text style={st.metricText}>{(p.views ?? 0).toLocaleString('en-US')}</Text>
                      </View>
                      <View style={st.metric}>
                        <HeartIcon size={15} />
                        <Text style={st.metricText}>{(p.likes ?? 0).toLocaleString('en-US')}</Text>
                      </View>
                      <View style={st.metric}>
                        <CommentIcon size={15} />
                        <Text style={st.metricText}>{p.comments ?? 0}</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={st.actions}>
                      {p.status === 'approve' ? (
                        <Btn
                          label="Approve"
                          icon={<CheckIcon size={15} color="#0A1206" />}
                          small
                          onPress={() => {
                            p.status = 'scheduled';
                            record({
                              agent: 'Content',
                              text: `You approved “${p.title}” — it goes out ${prettyDay(p.day).toLowerCase()} at ${p.time}.`,
                            });
                            say('Approved — it goes out as planned');
                          }}
                        />
                      ) : null}
                      {p.status === 'draft' ? (
                        <Btn
                          label="Schedule"
                          icon={<CalendarIcon size={15} color="#0A1206" />}
                          small
                          onPress={() => {
                            p.status = 'scheduled';
                            record({
                              agent: 'Content',
                              text: `Scheduled “${p.title}” for ${prettyDay(p.day).toLowerCase()} at ${p.time}.`,
                            });
                            say(`Scheduled for ${prettyDay(p.day)}, ${p.time}`);
                          }}
                        />
                      ) : null}
                      <IconBtn size={34} onPress={() => openEdit(p)}>
                        <PencilIcon size={16} />
                      </IconBtn>
                      <IconBtn
                        size={34}
                        onPress={() => {
                          data.posts.unshift({ ...p, id: uid(), title: `${p.title} (copy)`, status: 'draft' });
                          commit();
                          say('Duplicated as a draft');
                        }}
                      >
                        <CopyIcon size={16} />
                      </IconBtn>
                      <IconBtn size={34} tone="bad" onPress={() => setKill(p)}>
                        <TrashIcon size={16} />
                      </IconBtn>
                    </View>
                  )}
                </View>
              </Glass>
            </Stagger>
          ))
        )}
      </Page>

      <Pressable style={st.fabHit} onPress={openNew}>
        <View style={st.fab}>
          <DocPenIcon size={20} color="#0A1206" />
          <Text style={st.fabText}>Write a post</Text>
        </View>
      </Pressable>

      {/* create / update */}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={isNew ? 'New piece' : 'Edit piece'} full>
        {edit ? (
          <View>
            <Field label="NAME" value={edit.title} onChangeText={(v) => set('title', v)} placeholder="Winter drop teaser" />

            <Text style={st.lab}>FORMAT</Text>
            <View style={{ marginBottom: 14 }}>
              <Segment items={KINDS} value={edit.kind} onChange={(k) => set('kind', k)} />
            </View>

            <Text style={st.lab}>GOES TO</Text>
            <View style={{ marginBottom: 14 }}>
              <Chips
                items={PLATFORMS.map((p) => PLATFORM_NAME[p])}
                on={edit.platforms.map((p) => PLATFORM_NAME[p])}
                icons={Object.fromEntries(PLATFORMS.map((p) => [PLATFORM_NAME[p], <PlatformMark key={p} k={p} size={14} />]))}
                onToggle={(name) => {
                  const k = PLATFORMS.find((p) => PLATFORM_NAME[p] === name) as Platform;
                  const on = edit.platforms.includes(k);
                  set('platforms', on ? edit.platforms.filter((p) => p !== k) : [...edit.platforms, k]);
                }}
              />
            </View>

            <Field
              label="CAPTION"
              value={edit.caption}
              onChangeText={(v) => set('caption', v)}
              placeholder="Say it the way you would say it in the shop."
              multiline
              lines={4}
            />
            <Btn
              label={write.busy ? 'Vexa is writing…' : 'Let Vexa write it'}
              icon={<SparkleIcon size={16} color="#0A1206" />}
              busy={write.busy}
              onPress={() =>
                write.run(1600, () =>
                  set('caption', writeCaption(data.me.business, data.me.trade, edit.kind, data.lessons)),
                )
              }
              full
              small
              style={{ marginBottom: 6 }}
            />
            {write.slow ? <Text style={st.slow}>Taking longer than usual — still writing.</Text> : null}

            <Field label="HASHTAGS" value={tags} onChangeText={setTags} placeholder="#berreto #lahore" style={{ marginTop: 10 }} />

            <Text style={st.lab}>DAY</Text>
            <View style={{ marginBottom: 14 }}>
              <Chips
                items={[day(0), day(1), day(2), day(3)].map(prettyDay)}
                on={[prettyDay(edit.day)]}
                onToggle={(label) => {
                  const match = [day(0), day(1), day(2), day(3)].find((d) => prettyDay(d) === label);
                  if (match) set('day', match);
                }}
              />
            </View>

            <Text style={st.lab}>TIME</Text>
            <View style={{ marginBottom: 16 }}>
              <Chips items={TIMES} on={[edit.time]} onToggle={(t) => set('time', t)} />
            </View>

            {err ? <Text style={st.err}>{err}</Text> : null}
            {save.slow ? <Text style={st.slow}>Slow connection — still saving.</Text> : null}

            <Btn
              label={isNew ? 'Add to the queue' : 'Save changes'}
              busy={save.busy}
              onPress={commitPost}
              full
              style={{ marginTop: 4 }}
            />
            {!isNew ? (
              <Btn
                label="Delete this piece"
                kind="danger"
                icon={<TrashIcon size={16} />}
                onPress={() => setKill(edit)}
                full
                small
                style={{ marginTop: 10 }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      {/* delete */}
      <Confirm
        open={!!kill}
        title="Delete this piece?"
        line={`“${kill?.title ?? ''}” is removed from the calendar. This cannot be undone.`}
        cta="Delete"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.posts = data.posts.filter((p) => p.id !== kill?.id);
          commit();
          setKill(null);
          setEdit(null);
          say('Deleted');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  week: { alignSelf: 'stretch' },
  weekInner: { flexDirection: 'row', paddingVertical: 11, paddingHorizontal: 6 },
  dayCell: { flex: 1, alignItems: 'center', gap: 5 },
  dayName: { color: C.textDim, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5 },
  dayDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  dayDiscHas: { borderColor: 'rgba(195,255,55,0.4)' },
  dayDiscOn: { backgroundColor: C.lime, borderColor: C.lime },
  dayNo: { color: C.text, fontSize: 12.5, fontWeight: '800' },
  dayDots: { flexDirection: 'row', gap: 2, height: 4 },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.lime },

  clear: { color: C.lime, fontSize: 11.5, fontWeight: '800' },

  card: { padding: 14, gap: 9 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: C.text, fontSize: 14.5, fontWeight: '800' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  cardMetaText: { color: C.textDim, fontSize: 11.5, fontWeight: '600' },
  caption: { color: C.textDim, fontSize: 12.5, lineHeight: 18 },
  tags: { color: C.green, fontSize: 11.5, fontWeight: '700' },

  metrics: { flexDirection: 'row', gap: 18, borderTopWidth: 1, borderTopColor: C.borderSoft, paddingTop: 10 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricText: { color: C.text, fontSize: 12, fontWeight: '700' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },

  fabHit: { position: 'absolute', right: 16, bottom: 16 },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.lime,
    borderRadius: R.pill,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderWidth: 5,
    borderColor: 'rgba(195,255,55,0.18)',
  },
  fabText: { color: '#0A1206', fontSize: 14, fontWeight: '900' },

  lab: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  err: { color: '#FF7A7A', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  slow: { color: '#FFC24B', fontSize: 11.5, fontWeight: '700', marginBottom: 8 },
});

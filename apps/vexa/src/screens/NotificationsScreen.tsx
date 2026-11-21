import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { BellIcon, ChartUpIcon, CheckIcon, DocPenIcon, MegaphoneIcon, SearchIcon, SparkleIcon, TrashIcon } from '../components/Icons';
import {
  Btn,
  Confirm,
  Empty,
  IconBtn,
  Lede,
  LoadingBar,
  Page,
  SectionTitle,
  Segment,
  SkeletonList,
  SlowNote,
  Stagger,
  Tag,
  useToast,
} from '../components/kit';
import { useLoad } from '../net';
import { commit, db, useDb, type Agent, type Notice } from '../store';
import { C, R } from '../theme';

const ICON: Record<Agent, React.ReactNode> = {
  Content: <DocPenIcon size={18} />,
  Sales: <ChartUpIcon size={18} />,
  Ads: <MegaphoneIcon size={18} />,
  Research: <SearchIcon size={18} />,
  Vexa: <SparkleIcon size={18} />,
};

export default function NotificationsScreen({ onOpen }: { onOpen?: (title: string) => void }) {
  const data = useDb();
  const load = useLoad(700);
  const [toast, say] = useToast();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [kill, setKill] = useState<Notice | null>(null);
  const [clear, setClear] = useState(false);

  const rows = data.notices.filter((n) => (tab === 'unread' ? !n.read : true));
  const unread = data.notices.filter((n) => !n.read).length;

  const WHERE: Record<Agent, string> = {
    Content: 'Content Agent',
    Sales: 'Sales Agent',
    Ads: 'Ads Agent',
    Research: 'Research Agent',
    Vexa: 'Make me Learn',
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={26}>
        <Lede text="What Vexa wants you to know. Tapping one takes you to the screen it came from." />

        <SlowNote visible={load.slow} />

        <Segment
          items={[
            { key: 'all', label: `All (${data.notices.length})` },
            { key: 'unread', label: `Unread (${unread})` },
          ]}
          value={tab}
          onChange={setTab}
        />

        <SectionTitle
          text="NOTIFICATIONS"
          right={
            unread ? (
              <Pressable
                onPress={() => {
                  data.notices.forEach((n) => {
                    n.read = true;
                  });
                  commit();
                  say('All marked read');
                }}
              >
                <Text style={st.link}>Mark all read</Text>
              </Pressable>
            ) : (
              <Tag text="All read" tone="green" />
            )
          }
        />

        {load.loading ? (
          <SkeletonList rows={3} />
        ) : rows.length === 0 ? (
          <Empty
            icon={<BellIcon size={24} />}
            title={tab === 'unread' ? 'Nothing unread' : 'Nothing yet'}
            line="Vexa only writes when something needs you, or when something good happened."
            cta={tab === 'unread' ? 'Show everything' : undefined}
            onCta={tab === 'unread' ? () => setTab('all') : undefined}
          />
        ) : (
          rows.map((n, i) => (
            <Stagger key={n.id} index={i} style={{ marginBottom: 9 }}>
              <Glass
                style={{ alignSelf: 'stretch' }}
                radius={R.lg}
                lit={!n.read}
                onPress={() => {
                  n.read = true;
                  commit();
                  onOpen?.(WHERE[n.agent]);
                }}
              >
                <View style={st.card}>
                  <View style={st.icon}>{ICON[n.agent]}</View>
                  <View style={{ flex: 1 }}>
                    <View style={st.head}>
                      <Text style={st.title}>{n.title}</Text>
                      {!n.read ? <View style={st.dot} /> : null}
                    </View>
                    <Text style={st.line}>{n.line}</Text>
                    <Text style={st.at}>
                      {n.agent} Agent · {n.at}
                    </Text>
                  </View>
                  <View style={{ gap: 7 }}>
                    {!n.read ? (
                      <IconBtn
                        size={30}
                        onPress={() => {
                          n.read = true;
                          commit();
                          say('Marked read');
                        }}
                      >
                        <CheckIcon size={14} />
                      </IconBtn>
                    ) : null}
                    <IconBtn size={30} tone="bad" onPress={() => setKill(n)}>
                      <TrashIcon size={14} />
                    </IconBtn>
                  </View>
                </View>
              </Glass>
            </Stagger>
          ))
        )}

        {rows.length ? (
          <Btn label="Clear all notifications" kind="ghost" onPress={() => setClear(true)} full style={{ marginTop: 12 }} />
        ) : null}
      </Page>

      <Confirm
        open={!!kill}
        title="Remove this notification?"
        line="It only goes from this list; whatever it was about stays."
        cta="Remove"
        danger
        onCancel={() => setKill(null)}
        onConfirm={() => {
          db.notices = data.notices.filter((n) => n.id !== kill?.id);
          commit();
          setKill(null);
          say('Removed');
        }}
      />

      <Confirm
        open={clear}
        title="Clear everything?"
        line="The whole list goes. Vexa keeps writing new ones."
        cta="Clear all"
        danger
        onCancel={() => setClear(false)}
        onConfirm={() => {
          db.notices = [];
          commit();
          setClear(false);
          say('List cleared');
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 13.5, fontWeight: '800', flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.lime },
  line: { color: C.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  at: { color: C.textFaint, fontSize: 10.5, marginTop: 4, fontWeight: '700' },
  link: { color: C.lime, fontSize: 11.5, fontWeight: '800' },
});

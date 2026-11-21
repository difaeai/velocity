import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Glass from '../components/Glass';
import { CheckIcon, PlugIcon, RefreshIcon, ShieldIcon, TrashIcon, WifiOffIcon } from '../components/Icons';
import {
  Btn,
  Confirm,
  ErrorNote,
  IconBtn,
  Lede,
  LoadingBar,
  Page,
  PlatformMark,
  Ring,
  SectionTitle,
  Sheet,
  SkeletonList,
  SlowNote,
  Stagger,
  Steps,
  Tag,
  useToast,
} from '../components/kit';
import { useAction, useLoad, useSteps } from '../net';
import { commit, useDb, type Account } from '../store';
import { C, R } from '../theme';

const JOB = ['Opening the account page', 'Waiting for your permission', 'Checking what Vexa may do', 'Saving the connection'];

export default function ConnectedAccounts() {
  const data = useDb();
  const load = useLoad(850);
  const refresh = useAction();
  const [toast, say] = useToast();

  const [connect, setConnect] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);
  const [cut, setCut] = useState<Account | null>(null);
  const [perm, setPerm] = useState<Account | null>(null);
  const tries = useRef<Record<string, number>>({});
  const job = useSteps(JOB, 850);

  const on = data.accounts.filter((a) => a.state === 'connected');

  const start = (a: Account) => {
    setFailed(false);
    tries.current[a.key] = (tries.current[a.key] ?? 0) + 1;
    // YouTube refuses the first time, so the failure and retry are real screens.
    const willFail = a.key === 'youtube' && tries.current[a.key] === 1;

    job.start(() => {
      job.reset();
      if (willFail) {
        setFailed(true);
        return;
      }
      const row = data.accounts.find((x) => x.key === a.key);
      if (row) {
        row.state = 'connected';
        row.followers = row.followers ?? 1200 + Math.floor(Math.random() * 9000);
        row.synced = 'Just now';
      }
      commit();
      setConnect(null);
      say(`${a.name} connected`);
    });
  };

  return (
    <>
      <LoadingBar active={load.loading} />
      <Page bottom={30}>
        <Lede text="The accounts Vexa works through. She only ever does what you tick here, and you can cut her off from any of them in one tap." />

        <SlowNote visible={load.slow} />

        {load.loading ? (
          <SkeletonList rows={2} />
        ) : (
          <>
            <Stagger>
              <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
                <View style={st.hero}>
                  <Ring pct={on.length / data.accounts.length} size={90} label={`${on.length}/${data.accounts.length}`} sub="live" />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={st.heroTitle}>{on.length} accounts connected</Text>
                    <Text style={st.heroSub}>
                      {on.reduce((n, a) => n + (a.followers ?? 0), 0).toLocaleString('en-US')} followers reachable. Last
                      sync {on[0]?.synced ?? '—'}.
                    </Text>
                    <Btn
                      label={refresh.busy ? 'Syncing…' : 'Sync all'}
                      icon={<RefreshIcon size={15} color="#0A1206" />}
                      busy={refresh.busy}
                      small
                      onPress={() =>
                        refresh.run(1500, () => {
                          on.forEach((a) => {
                            a.synced = 'Just now';
                          });
                          commit();
                          say('All accounts synced');
                        })
                      }
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    />
                  </View>
                </View>
              </Glass>
            </Stagger>

            {refresh.slow ? <SlowNote visible line="Slow connection — the sync is still running" /> : null}

            <SectionTitle text="ACCOUNTS" right={<Tag text={`${on.length} on`} tone="green" />} />

            {data.accounts.map((a, i) => (
              <Stagger key={a.key} index={i} style={{ marginBottom: 9 }}>
                <Glass style={{ alignSelf: 'stretch' }} radius={R.lg} lit={a.state === 'connected'}>
                  <View style={st.card}>
                    <View style={st.mark}>
                      <PlatformMark k={a.key} size={24} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={st.nameRow}>
                        <Text style={st.name}>{a.name}</Text>
                        {a.state === 'connected' ? <Tag text="Connected" tone="green" /> : <Tag text="Not connected" />}
                      </View>
                      <Text style={st.sub}>
                        {a.state === 'connected'
                          ? `${a.handle} · ${(a.followers ?? 0).toLocaleString('en-US')} followers`
                          : 'Vexa cannot post here yet'}
                      </Text>
                      {a.state === 'connected' ? <Text style={st.synced}>Synced {a.synced}</Text> : null}
                    </View>

                    {a.state === 'connected' ? (
                      <View style={st.rowBtns}>
                        <IconBtn size={34} onPress={() => setPerm(a)}>
                          <ShieldIcon size={16} />
                        </IconBtn>
                        <IconBtn size={34} tone="bad" onPress={() => setCut(a)}>
                          <TrashIcon size={16} />
                        </IconBtn>
                      </View>
                    ) : (
                      <Btn
                        label="Connect"
                        small
                        icon={<PlugIcon size={15} color="#0A1206" />}
                        onPress={() => {
                          setConnect(a);
                          setFailed(false);
                          job.reset();
                        }}
                      />
                    )}
                  </View>
                </Glass>
              </Stagger>
            ))}

            <Stagger index={6}>
              <Glass style={{ alignSelf: 'stretch', marginTop: 6 }} radius={R.lg}>
                <View style={st.safety}>
                  <ShieldIcon size={20} />
                  <Text style={st.safetyText}>
                    Vexa never sees your password. Connecting hands her a token you can revoke from this screen or from
                    the platform itself.
                  </Text>
                </View>
              </Glass>
            </Stagger>
          </>
        )}
      </Page>

      {/* connect: permissions, then the job, then success or failure */}
      <Sheet
        open={!!connect}
        onClose={() => {
          setConnect(null);
          job.reset();
        }}
        title={connect ? `Connect ${connect.name}` : ''}
      >
        {connect ? (
          <View style={{ gap: 14 }}>
            {job.running ? (
              <View style={{ gap: 16, paddingVertical: 6 }}>
                <Steps steps={JOB} at={job.at} />
                {job.at >= 2 ? (
                  <View style={st.slowRow}>
                    <WifiOffIcon size={16} />
                    <Text style={st.slowText}>{connect.name} is slow to answer — still waiting.</Text>
                  </View>
                ) : null}
              </View>
            ) : failed ? (
              <ErrorNote
                onRetry={() => start(connect)}
                line={`${connect.name} refused the connection. This happens when the permission screen is closed too early.`}
              />
            ) : (
              <>
                <Text style={st.permLede}>Vexa will be allowed to:</Text>
                {connect.scopes.map((s, i) => (
                  <Stagger key={s} index={i}>
                    <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                      <View style={st.permRow}>
                        <CheckIcon size={17} />
                        <Text style={st.permText}>{s}</Text>
                      </View>
                    </Glass>
                  </Stagger>
                ))}
                <Text style={st.permNote}>Nothing else. She cannot change your password or see your messages with anyone else.</Text>
                <Btn label={`Continue to ${connect.name}`} onPress={() => start(connect)} full />
              </>
            )}
          </View>
        ) : null}
      </Sheet>

      {/* read permissions of a connected account */}
      <Sheet open={!!perm} onClose={() => setPerm(null)} title={perm ? `${perm.name} permissions` : ''}>
        {perm ? (
          <View style={{ gap: 10 }}>
            {perm.scopes.map((s, i) => (
              <Stagger key={s} index={i}>
                <Glass style={{ alignSelf: 'stretch' }} radius={R.md}>
                  <View style={st.permRow}>
                    <CheckIcon size={17} />
                    <Text style={st.permText}>{s}</Text>
                  </View>
                </Glass>
              </Stagger>
            ))}
            <Btn
              label="Disconnect this account"
              kind="danger"
              onPress={() => {
                setCut(perm);
                setPerm(null);
              }}
              full
              style={{ marginTop: 6 }}
            />
          </View>
        ) : null}
      </Sheet>

      <Confirm
        open={!!cut}
        title={`Disconnect ${cut?.name ?? ''}?`}
        line="Vexa stops posting and answering there at once. Anything already scheduled for it is paused."
        cta="Disconnect"
        danger
        onCancel={() => setCut(null)}
        onConfirm={() => {
          const row = data.accounts.find((a) => a.key === cut?.key);
          if (row) {
            row.state = 'off';
            row.synced = undefined;
          }
          commit();
          setCut(null);
          say(`${cut?.name} disconnected`);
        }}
      />

      {toast}
    </>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  heroTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  heroSub: { color: C.textDim, fontSize: 11.5, lineHeight: 17 },

  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  mark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: C.text, fontSize: 14.5, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 11.5, marginTop: 3 },
  synced: { color: C.textFaint, fontSize: 10.5, marginTop: 2 },
  rowBtns: { flexDirection: 'row', gap: 7 },

  safety: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  safetyText: { color: C.textDim, fontSize: 12, lineHeight: 18, flex: 1 },

  permLede: { color: C.text, fontSize: 13.5, fontWeight: '700' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  permText: { color: C.text, fontSize: 13, flex: 1 },
  permNote: { color: C.textDim, fontSize: 11.5, lineHeight: 17 },

  slowRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  slowText: { color: '#FFC24B', fontSize: 11.5, fontWeight: '700', flex: 1 },
});

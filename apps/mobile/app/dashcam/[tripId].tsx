/**
 * Watch a ride's dash cam video.
 *
 * Reached from the trip screen on both sides — while the ride runs and after it
 * ends — and from the driver's ride history. What this person may see is the
 * backend's decision (getDashcamClips): the driver, the whole ride; a rider,
 * their own time in the car. This screen only plays what comes back.
 *
 * The clips play one after another in a plain HTML5 player inside a WebView:
 * the app already ships react-native-webview, and a native video player would
 * be a new native module for one screen. Each clip can be downloaded, which is
 * how somebody keeps a copy — the video is deleted 24 hours after the ride, and
 * proof that disappears with it is no proof at all.
 *
 * Everything shown and everything downloaded carries "Velocity Rides Travel
 * Proof": drawn over the player here, burned into the file by getDashcamProof.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

import { Text } from '../../src/ui/Text';
import { api, type DashcamClipView } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { useForegroundInterval } from '../../src/hooks/useForegroundInterval';

type Clips = Awaited<ReturnType<typeof api.getDashcamClips>>;

/** New clips land every couple of minutes while the ride is running. */
const LIVE_REFRESH_MS = 60_000;

/** "10:42 pm" — the clock a rider reads, not an ISO string. */
function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "10:42 pm today" / "10:42 pm tomorrow" — the day only when it is not today. */
function deadline(ms: number): string {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  return `${clock(ms)} ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : day.toDateString()}`;
}

/**
 * The player: plays the clips in order and tells the app which one is on. It
 * holds no URLs of its own — the app hands them in with `setUrls`, so clips that
 * arrive mid-ride join the end of the list without reloading the page and
 * restarting the clip somebody is watching.
 */
const PLAYER_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}
#wrap{position:relative;width:100%;height:100%;}
video{width:100%;height:100%;object-fit:contain;background:#000;}
#wm{position:absolute;top:0;right:0;bottom:0;left:0;overflow:hidden;pointer-events:none;}
#tile{position:absolute;left:-50%;top:-50%;width:200%;height:200%;transform:rotate(-26deg);
display:flex;flex-wrap:wrap;align-content:flex-start;gap:24px 28px;}
#tile span{font:900 11px/1 sans-serif;letter-spacing:1px;white-space:nowrap;
color:rgba(255,255,255,.28);text-shadow:0 0 1px rgba(0,0,0,.3);}
#head{position:absolute;left:0;right:0;top:0;padding:6px 0;text-align:center;pointer-events:none;
background:rgba(0,0,0,.45);color:#fff;font:900 12px sans-serif;letter-spacing:1.5px;}</style>
</head><body>
<div id="wrap">
<video id="v" controls playsinline controlslist="nofullscreen nodownload" disablepictureinpicture></video>
<div id="wm"><div id="tile"></div></div>
<div id="head">VELOCITY RIDES · TRAVEL PROOF</div>
</div>
<script>
var tile = document.getElementById('tile');
for (var k = 0; k < 220; k++) {
  var s = document.createElement('span');
  s.textContent = 'VELOCITY RIDES TRAVEL PROOF';
  tile.appendChild(s);
}
var urls = [];
var i = 0;
var v = document.getElementById('v');
function play(n) {
  if (!urls[n]) return;
  i = n;
  v.src = urls[n];
  v.play().catch(function () {});
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(n));
}
v.addEventListener('ended', function () { play(i + 1); });
window.setUrls = function (next) { var first = urls.length === 0; urls = next; if (first) play(0); };
window.playAt = play;
</script></body></html>`;

export default function DashcamViewer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;

  const [data, setData] = useState<Clips | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(0);
  // `object`, not the default: WebView's props are `WebViewProps & P`, and the
  // default P of `undefined` turns them into `never` the moment a ref is typed.
  const webRef = useRef<WebView<object>>(null);
  /** Set once the player page is up; anything injected before that is lost. */
  const playerLoaded = useRef(false);
  /** The clip whose marked copy is being made (the first ask burns it on the server). */
  const [preparing, setPreparing] = useState<number | null>(null);

  async function download(c: DashcamClipView) {
    if (!tripId) return;
    setPreparing(c.startedAt);
    try {
      const { url } = await api.getDashcamProof({ tripId, clip: `${c.startedAt}.mp4` });
      // The file is served as a download, so the browser saves it to the phone.
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Could not prepare the download', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPreparing(null);
    }
  }

  const load = useCallback(() => {
    if (!tripId) return;
    api
      .getDashcamClips({ tripId })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the video.'));
  }, [tripId]);

  // Loads at once; keeps loading only while the ride is still recording.
  useForegroundInterval(!data || data.live ? load : null, LIVE_REFRESH_MS);

  const clips: DashcamClipView[] = useMemo(() => data?.clips ?? [], [data]);
  const handUrls = useCallback(() => {
    webRef.current?.injectJavaScript(`window.setUrls(${JSON.stringify(clips.map((c) => c.url))});true;`);
  }, [clips]);
  useEffect(() => {
    if (playerLoaded.current) handUrls();
  }, [handUrls]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}
        >
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Dash cam</Text>
        <View style={{ width: 48 }} />
      </View>

      {!data && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {data?.live ? (
            <Text style={styles.status}>● Recording now — new clips appear every few minutes.</Text>
          ) : data?.expiresAt && clips.length > 0 ? (
            <Text style={styles.status}>Deleted at {deadline(data.expiresAt)}</Text>
          ) : null}

          {error && !data ? (
            <Text style={styles.empty}>{error}</Text>
          ) : data?.expired ? (
            <Text style={styles.empty}>
              This ride&apos;s video was deleted 24 hours after the ride ended.
            </Text>
          ) : clips.length === 0 ? (
            <Text style={styles.empty}>
              {data?.live
                ? 'The first clip will appear here in a couple of minutes.'
                : 'No dash cam video was recorded on this ride.'}
            </Text>
          ) : (
            <>
              <View style={styles.player}>
                <WebView
                  ref={webRef}
                  source={{ html: PLAYER_HTML }}
                  style={styles.video}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  // Native fullscreen would drop the watermark drawn over the video.
                  allowsFullscreenVideo={false}
                  originWhitelist={['*']}
                  onLoadEnd={() => {
                    playerLoaded.current = true;
                    handUrls();
                  }}
                  onMessage={(e) => setPlaying(Number(e.nativeEvent.data) || 0)}
                />
              </View>

              {clips.map((c, i) => (
                <View key={c.startedAt} style={[styles.clip, i === playing && styles.clipPlaying]}>
                  <Pressable
                    style={styles.clipMain}
                    onPress={() => webRef.current?.injectJavaScript(`window.playAt(${i});true;`)}
                  >
                    <Text style={styles.clipTitle}>
                      {i === playing ? '▶ ' : ''}Clip {i + 1} · {clock(c.startedAt)}
                    </Text>
                    <Text style={styles.clipSize}>{(c.sizeBytes / 1_000_000).toFixed(1)} MB</Text>
                  </Pressable>
                  {preparing === c.startedAt ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Pressable
                      onPress={() => void download(c)}
                      disabled={preparing !== null}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Download clip ${i + 1}, marked Velocity Rides Travel Proof`}
                    >
                      <Text style={[styles.save, preparing !== null && { opacity: 0.4 }]}>Download</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </>
          )}

          <Text style={styles.note}>
            Only the driver and the people in this car can watch this, each their own part of the
            ride. It is deleted 24 hours after the ride ends — tap Download to keep a copy of a clip,
            marked &quot;Velocity Rides Travel Proof&quot;.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { color: colors.primary, fontSize: 15, fontWeight: '700' },
    title: { color: colors.text, fontSize: 18, fontWeight: '900' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 16, gap: 10, paddingBottom: 40 },
    status: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },
    empty: { color: colors.text, fontSize: 14, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
    player: { height: 240, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
    video: { flex: 1, backgroundColor: '#000' },
    clip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    clipPlaying: { borderColor: colors.primary },
    clipMain: { flex: 1, gap: 2 },
    clipTitle: { color: colors.text, fontSize: 13.5, fontWeight: '800' },
    clipSize: { color: colors.muted, fontSize: 11.5 },
    save: { color: colors.primary, fontSize: 13, fontWeight: '800' },
    note: { color: colors.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  }),
);

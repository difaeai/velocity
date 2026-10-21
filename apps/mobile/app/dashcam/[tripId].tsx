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
 * be a new native module for one screen. Each clip also opens in the browser,
 * which is how somebody keeps a copy — the video is deleted 24 hours after the
 * ride, and proof that disappears with it is no proof at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
<style>html,body{margin:0;padding:0;background:#000;height:100%;}
video{width:100%;height:100%;object-fit:contain;background:#000;}</style>
</head><body>
<video id="v" controls playsinline></video>
<script>
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
                  allowsFullscreenVideo
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
                  <Pressable onPress={() => void Linking.openURL(c.url)} hitSlop={8}>
                    <Text style={styles.save}>Save</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <Text style={styles.note}>
            Only the driver and the people in this car can watch this, each their own part of the
            ride. It is deleted 24 hours after the ride ends — tap Save to keep a copy of a clip.
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

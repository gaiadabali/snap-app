import { File, Paths } from 'expo-file-system';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deviceInfo, isAvailable, recognise } from '../../modules/snap-ocr/src';

/**
 * The device bench — `docs/ON-DEVICE.md` §6.4 step 2.
 *
 * §6.4 specifies "a developer screen in the dev build that runs `snap-ocr` over
 * a folder of images and exports one DocDOM per document". It was specified and
 * never built, which meant `SnapOcrModule` compiled, linked, shipped in the APK
 * — and was called by nothing. The module could have been entirely broken and
 * every test in the repository would still have passed.
 *
 * NO FOLDER, AND NO STORAGE PERMISSION. Android 11+ scoped storage makes
 * pushing 300 images onto a handset and pulling results back out far more
 * trouble than it is worth. `adb reverse tcp:8099 tcp:8099` instead makes
 * `bench/device_server.py` reachable from the phone at 127.0.0.1 over the USB
 * cable: images come down, DocDOMs go back, and the phone needs no permission,
 * no network and no files of its own.
 *
 * WHAT THIS SCREEN MAY AND MAY NOT CONCLUDE. It measures FUNCTION — does ML Kit
 * resolve on this handset, do boxes land on the right glyphs, can the
 * structurer read what came back. Timings are recorded but the verdict on them
 * belongs to `bench/devices.py`, which refuses to let a phone above the §1.2
 * floor settle a §6.1 fit question. That refusal lives on the bench side on
 * purpose: a number this screen prints is not a number anybody may quote.
 */

const DEFAULT_BENCH = 'http://127.0.0.1:8099';

type Doc = { id: string; pages: number };
type Manifest = { device: string; label: string; tier: string; documents: Doc[] };

type Progress = {
  done: number;
  total: number;
  current: string;
  failures: string[];
  medianMs: number | null;
};

export default function DevBench() {
  const [url, setUrl] = useState(DEFAULT_BENCH);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);

  const available = isAvailable();
  const info = deviceInfo();

  const say = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), line]);
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setLog([]);
    setProgress(null);
    const base = url.replace(/\/+$/, '');
    const timings: number[] = [];
    const failures: string[] = [];

    try {
      say(`GET ${base}/manifest`);
      const manifest: Manifest = await (await fetch(`${base}/manifest`)).json();
      say(`${manifest.documents.length} documents, tier ${manifest.tier}`);
      say(`bench expects: ${manifest.label}`);

      let done = 0;
      for (const doc of manifest.documents) {
        try {
          for (let page = 1; page <= doc.pages; page += 1) {
            // Written to the cache directory rather than kept in memory: a
            // 300-document run holds one page at a time, and `recognise` takes
            // a URI because that is what the platform recognisers take.
            const response = await fetch(`${base}/page/${doc.id}/${page}`);
            if (!response.ok) throw new Error(`page fetch ${response.status}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const file = new File(Paths.cache, `bench-${doc.id}-${page}.png`);
            try {
              file.create({ overwrite: true });
              file.write(bytes);

              const result = await recognise(file.uri);
              if (!result) throw new Error('snap-ocr unavailable on this build');
              timings.push(result.timings.recogniseMs);

              const post = await fetch(`${base}/page/${doc.id}/${page}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
              });
              if (!post.ok) {
                // The server refuses a handset that is not the one --device
                // names. That refusal must stop the run, not be counted as one
                // more failed document.
                const body = await post.text();
                throw new Error(`bench refused (${post.status}): ${body}`);
              }
            } finally {
              try {
                file.delete();
              } catch {
                // A cache file we could not remove is not worth failing a run.
              }
            }
          }
          done += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith('bench refused')) throw err;
          failures.push(`${doc.id}: ${message}`);
          say(`FAILED ${doc.id}: ${message}`);
        }

        const sorted = [...timings].sort((a, b) => a - b);
        setProgress({
          done,
          total: manifest.documents.length,
          current: doc.id,
          failures,
          medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
        });
      }
      say(`finished: ${done}/${manifest.documents.length}, ${failures.length} failed`);
    } catch (err) {
      say(`STOPPED: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [url, say]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Device bench</Text>
      <Text style={styles.note}>docs/ON-DEVICE.md §6.4 step 2</Text>

      <View style={styles.card}>
        <Row label="snap-ocr" value={available ? 'available' : 'NOT AVAILABLE'} />
        <Row label="model" value={info?.model ?? '—'} />
        <Row label="OS" value={info ? `${info.platform} ${info.osVersion}` : '—'} />
        <Row label="total RAM" value={info ? `${info.totalMemoryMb} MB` : '—'} />
      </View>

      {!available ? (
        <Text style={styles.warn}>
          On-device recognition is unavailable on this build. In Expo Go and on web that is
          expected — §9 treats server-only as a real outcome. On a dev build it means Play
          services could not supply the unbundled ML Kit model.
        </Text>
      ) : null}

      <Text style={styles.label}>bench server</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!running}
      />
      <Text style={styles.hint}>adb reverse tcp:8099 tcp:8099</Text>

      <Pressable
        style={[styles.button, (running || !available) && styles.buttonOff]}
        disabled={running || !available}
        onPress={run}
      >
        {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run</Text>}
      </Pressable>

      {progress ? (
        <View style={styles.card}>
          <Row label="progress" value={`${progress.done} / ${progress.total}`} />
          <Row label="current" value={progress.current} />
          <Row label="failed" value={String(progress.failures.length)} />
          <Row
            label="median recognise"
            value={progress.medianMs === null ? '—' : `${progress.medianMs.toFixed(0)} ms`}
          />
          <Text style={styles.hint}>
            Timings are recorded, not judged. bench/devices.py decides whether this handset
            may settle a §6.1 fit question — above the 4 GB floor it may not.
          </Text>
        </View>
      ) : null}

      {log.length ? (
        <View style={styles.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAF9F7' },
  content: { padding: 20, gap: 12 },
  h1: { fontSize: 26, fontWeight: '300', color: '#14181D' },
  note: { fontSize: 12, color: '#6B7280', marginTop: -8 },
  card: { backgroundColor: '#fff', borderColor: '#E2DFD8', borderWidth: 1, padding: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 12, letterSpacing: 1, color: '#6B7280', textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: '#14181D', flexShrink: 1, textAlign: 'right' },
  label: { fontSize: 12, letterSpacing: 1, color: '#6B7280', textTransform: 'uppercase' },
  input: {
    borderWidth: 1, borderColor: '#E2DFD8', backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#14181D',
  },
  hint: { fontSize: 11, color: '#6B7280' },
  warn: { fontSize: 13, color: '#8A5A00', backgroundColor: '#FFF6E5', padding: 12 },
  button: { backgroundColor: '#1878D8', paddingVertical: 14, alignItems: 'center' },
  buttonOff: { backgroundColor: '#9CA3AF' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  logBox: { backgroundColor: '#14181D', padding: 12, gap: 2 },
  logLine: { color: '#D7E3F4', fontSize: 11, fontFamily: 'monospace' },
});

/**
 * The eyes of the driver verification engine — ours, running in the function.
 *
 * Three pieces of machinery, no account with anybody:
 *
 *   · sharp          decodes whatever the handset uploaded and prepares it.
 *   · TensorFlow.js  runs three small networks that ship inside face-api:
 *                    a face detector, 68 landmarks, and the 128-dimension
 *                    descriptor two faces are compared by.
 *   · Tesseract      reads the text off a card.
 *
 * All of it is WASM and plain JavaScript. There is no native binary to build,
 * no model to download at cold start, no key, and no request leaving the
 * machine — which also means a driver's CNIC photograph never does either.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. This file gets numbers OUT of pictures and
 * makes no judgements at all: no thresholds, no verdicts, nothing with an
 * opinion about an applicant. Every rule that decides anything is in
 * domain/localVision.ts, where it can be tested without a model. If you are
 * about to add an `if` with a number in it, add it there instead.
 *
 * COST. Roughly 0.4 s per face and 1 s per page of text on the function's own
 * CPU, measured, against 10–40 s and a per-image charge for the vision call
 * this replaced. The models load from disk in under a tenth of a second and are
 * cached for the life of the instance, so only the first application after a
 * cold start pays for the setup.
 */
import fs from 'node:fs';

import { logger } from 'firebase-functions';

import type * as TF from '@tensorflow/tfjs';
import type { Worker } from 'tesseract.js';

import {
  IMAGE_DESTROYED_BELOW,
  MIN_DOCUMENT_WORDS,
  OCR_CONFIDENCE_FLOOR,
  measureFaceGeometry,
  textDensity,
  type FaceGeometry,
} from '../domain/localVision';

/**
 * The libraries, loaded the first time something actually looks at an image.
 *
 * NOT imported at the top of the file, and that is not style. `index.ts`
 * exports every callable in the backend, so a top-level import here is executed
 * on the cold start of EVERY function in the project — the OTP exchange, the
 * fare quote, the trip writes, all of it. Measured, that is 379 ms and 89 MB
 * added to each one (sharp 86, TensorFlow.js 211, face-api 62, Tesseract 20)
 * for machinery that only two of them will ever call.
 *
 * It matters here more than it usually would: this backend has already been
 * through a round of work to get login codes out faster, and cold starts were
 * most of that problem. Paying 379 ms of someone else's cold start to save
 * 379 ms on a verification that takes ten seconds is the wrong way round.
 *
 * Loaded together rather than one by one because reading an image needs all of
 * them, and cached for the life of the instance, so only the first application
 * after a cold start pays.
 */
interface Machinery {
  sharp: typeof import('sharp').default;
  tf: typeof import('@tensorflow/tfjs');
  wasm: typeof import('@tensorflow/tfjs-backend-wasm');
  faceapi: typeof import('@vladmandic/face-api/dist/face-api.node-wasm');
  createWorker: typeof import('tesseract.js').createWorker;
}

let machinery: Machinery | null = null;

/* eslint-disable @typescript-eslint/no-require-imports */
function load(): Machinery {
  // sharp's CommonJS build exports the callable itself; the `.default` fallback
  // is there so a future ESM-interop shape does not break image decoding at
  // runtime in a way the types would not catch.
  const sharpModule = require('sharp');
  machinery ??= {
    sharp: sharpModule.default ?? sharpModule,
    tf: require('@tensorflow/tfjs'),
    wasm: require('@tensorflow/tfjs-backend-wasm'),
    faceapi: require('@vladmandic/face-api/dist/face-api.node-wasm'),
    createWorker: require('tesseract.js').createWorker,
  };
  return machinery;
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The detector's input resolution.
 *
 * 416 is the size the tiny detector was trained at. Smaller is faster and
 * starts missing the small, off-centre face in a photograph of a CNIC held at
 * arm's length — which is the comparison the whole face check depends on.
 */
const DETECTOR_INPUT = 416;
/**
 * A second, slower look for a face too small to find at 416.
 *
 * This is not belt and braces, it is the main case for the card: the portrait
 * printed on a CNIC is a small part of the card, and the card is a small part
 * of a photograph somebody took of it on a table. Measured on a synthetic card
 * carrying a real portrait, the face came to a quarter of one percent of the
 * frame and 416 could not see it at all — and the whole face comparison depends
 * on finding it. Only paid for when the first pass comes back empty.
 */
const DETECTOR_INPUT_FINE = 800;
/** Below this the detector has not really found a face. */
const DETECTOR_SCORE = 0.4;

/**
 * Long edge an image is reduced to before the face nets see it.
 *
 * Generous, and it has to be. The detector downsamples to its own input size,
 * so this number costs nothing there — but the DESCRIPTOR does not: it crops
 * the face out of this tensor and resizes that crop to 150×150, so a face
 * smaller than about 150 pixels here yields a descriptor built from an
 * upsampled blur.
 *
 * That is not a corner case, it is the main case. The portrait printed on a
 * CNIC is roughly a tenth of the card's width, so a card reduced to 1024 px
 * leaves a face of about 100 px. Measured at that size the descriptors stopped
 * separating people at all — a known different person came out at 0.60 and a
 * known same person at 0.69, the wrong way round. At 1600 the face clears 150
 * and the ordering holds. Images are never scaled UP: a 300-pixel upload stays
 * 300 pixels and is simply a worse photograph.
 */
const FACE_MAX_EDGE = 1600;

/**
 * Tesseract reads printed card text best at something like a 300 dpi scan.
 *
 * Phone photographs of a CNIC arrive anywhere from 600 to 4000 pixels wide, so
 * the long edge is pushed INTO this band in both directions — a small upload is
 * enlarged, which measurably helps, and a 12-megapixel one is reduced, which
 * costs nothing but time to keep.
 */
const OCR_MIN_EDGE = 1400;
const OCR_MAX_EDGE = 2400;

/** Refuse anything implausible as a document photograph rather than decode it. */
const MAX_IMAGE_BYTES = 12_000_000;

// ── Model loading, once per instance ─────────────────────────────────────────

let backendReady: Promise<boolean> | null = null;

/**
 * Bring up the WASM backend.
 *
 * The one awkward part of running TensorFlow.js server-side: the backend loads
 * its `.wasm` by calling `fetch` on a path, and Node's fetch has no scheme for
 * a local file, so it throws "unknown scheme" on a perfectly good path. Rather
 * than serve the binary over HTTP from the CDN — a network round trip on every
 * cold start, for a file already sitting in node_modules — the platform's fetch
 * is taught to answer local paths off the disk.
 */
/** The binaries tfjs may ask for, any of which it picks by host capability. */
const WASM_BINARIES = [
  'tfjs-backend-wasm.wasm',
  'tfjs-backend-wasm-simd.wasm',
  'tfjs-backend-wasm-threaded-simd.wasm',
];

async function startBackend(): Promise<boolean> {
  const { tf, wasm } = load();
  const wasmDir = `${require.resolve('@tensorflow/tfjs-backend-wasm/package.json').replace(/package\.json$/, '')}dist/`;

  const platform = tf.env().platform as { fetch: (p: string, i?: RequestInit) => Promise<Response> };
  const upstream = platform.fetch.bind(platform);
  platform.fetch = async (path: string, init?: RequestInit): Promise<Response> => {
    if (/^https?:/i.test(path)) return upstream(path, init);
    // A 404 rather than a throw. Emscripten calls this from inside its own
    // callback and rethrows whatever comes out as an UNCAUGHT exception — see
    // the pre-flight check below for what that costs — so this must not be the
    // thing that raises.
    if (!fs.existsSync(path)) {
      logger.error('Local vision: a WASM binary is missing', { path });
      return new Response(null, { status: 404 });
    }
    return new Response(fs.readFileSync(path), {
      status: 200,
      headers: { 'content-type': 'application/wasm' },
    });
  };

  /**
   * Look before leaping, because this particular failure cannot be caught.
   *
   * `tf.setBackend('wasm')` does not reject when the binary will not load.
   * Emscripten instantiates it inside a callback and rethrows the error as an
   * uncaught exception, which kills the process — tested, by hiding the three
   * `.wasm` files: the try/catch below never ran and node exited on ENOENT.
   *
   * In a deployed container that is not a degraded engine, it is a verification
   * function that crashes on every invocation, and an applicant whose job sits
   * in `running` forever. So the files are checked for first, and when they are
   * not there the slower backend is chosen deliberately instead of discovered
   * by crashing.
   */
  const binariesPresent = WASM_BINARIES.every((file) => fs.existsSync(`${wasmDir}${file}`));

  try {
    if (!binariesPresent) {
      logger.error('Local vision: the WASM binaries are not installed', { wasmDir });
    } else {
      wasm.setWasmPaths(wasmDir, true);
      await tf.setBackend('wasm');
      await tf.ready();
      if (tf.getBackend() === 'wasm') return true;
    }
  } catch (e) {
    logger.error('Local vision: the WASM backend would not start', { e });
  }

  /**
   * Fall back to the plain-JavaScript CPU backend rather than giving up.
   *
   * WASM is about fifteen times faster — 0.4 s a face against 7 s — but the two
   * agree to four decimal places on the only output that decides anything: the
   * same pair of faces measured 0.5116 on WASM and 0.5117 on CPU. So the slow
   * path is the SAME answer, late, and six documents still finish inside the
   * sweeper's timeout with room to spare.
   *
   * Worth the extra branch because the WASM backend is the one piece of this
   * engine that depends on its environment: it loads a binary by asking the
   * platform to fetch a local path, which Node will not do, so the fetch above
   * is patched to read it off the disk. If that ever stops working in a
   * deployed container, the choice is a slower engine or no engine — and no
   * engine means every driver applicant in the country waits for a human.
   */
  try {
    await tf.setBackend('cpu');
    await tf.ready();
    if (tf.getBackend() === 'cpu') {
      logger.warn('Local vision: running on the CPU backend — same answers, roughly 15x slower');
      return true;
    }
  } catch (e) {
    logger.error('Local vision: no TensorFlow backend would start at all', { e });
  }
  return false;
}

let modelsReady: Promise<boolean> | null = null;

/**
 * Load the three networks from the weights that ship with the package.
 *
 * Nothing is fetched: `@vladmandic/face-api` publishes its own `model/`
 * directory, so the weights arrive with `npm ci` at deploy time and are read
 * off the local disk. That is the difference between a cold start of about a
 * tenth of a second and one that depends on somebody else's CDN being up.
 */
function loadModels(): Promise<boolean> {
  modelsReady ??= (async () => {
    try {
      const { tf, faceapi } = load();
      backendReady ??= startBackend();
      if (!(await backendReady)) {
        logger.error('Local vision: WASM backend did not start');
        return false;
      }
      const dir = require
        .resolve('@vladmandic/face-api/package.json')
        .replace(/package\.json$/, 'model');
      await faceapi.nets.tinyFaceDetector.loadFromDisk(dir);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);
      await faceapi.nets.faceExpressionNet.loadFromDisk(dir);
      logger.info('Local vision: face models loaded', { backend: tf.getBackend() });
      return true;
    } catch (e) {
      logger.error('Local vision: face models failed to load', { e });
      return false;
    }
  })();
  return modelsReady;
}

// ── Tesseract, once per instance, one page at a time ─────────────────────────

let ocrWorker: Promise<Worker | null> | null = null;
/**
 * One page at a time.
 *
 * A Tesseract worker is a single thread with one page buffer: two overlapping
 * `recognize` calls interleave into one another and come back with each other's
 * text. The sweeper is already sequential, so this only ever matters if two
 * callables land on one warm instance — but that is exactly the kind of failure
 * that would show up as one driver's name on another driver's card.
 */
let ocrQueue: Promise<unknown> = Promise.resolve();

function startOcr(): Promise<Worker | null> {
  ocrWorker ??= (async () => {
    try {
      // Untyped package, like ffmpeg-static elsewhere in this backend. It exists
      // so the language data is a dependency rather than a CDN download: a
      // 10 MB fetch on a cold start is both slow and a thing that can be down.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const data = require('@tesseract.js-data/eng') as { langPath: string };
      const worker = await load().createWorker('eng', 1, {
        langPath: data.langPath,
        gzip: true,
        // Nothing is cached to disk: only /tmp is writable here, the data is
        // already local, and a cache would be re-downloaded per instance anyway.
        cacheMethod: 'none',
        logger: () => undefined,
        errorHandler: (e: unknown) => logger.error('Local vision: OCR worker error', { e }),
      });
      logger.info('Local vision: OCR ready');
      return worker;
    } catch (e) {
      logger.error('Local vision: OCR failed to start', { e });
      return null;
    }
  })();
  return ocrWorker;
}

/**
 * True when the face networks came up. Nothing here needs a key.
 *
 * Separate from the OCR worker so the face scan does not pay for Tesseract: a
 * liveness check reads no text, and spinning up a 10 MB language model to look
 * at three selfies would add a second to a screen somebody is waiting on.
 */
export function faceEngineReady(): Promise<boolean> {
  return loadModels();
}

/** True when both halves came up — the faces and the text. */
export async function localVisionReady(): Promise<boolean> {
  const [models, worker] = await Promise.all([loadModels(), startOcr()]);
  return models && worker !== null;
}

// ── Images ───────────────────────────────────────────────────────────────────

/**
 * How soft an image is, as the variance of its Laplacian.
 *
 * The standard sharpness measure: convolve with a second-derivative kernel and
 * look at the spread of the result. A sharp edge swings it hard both ways, so a
 * crisp photograph of a card scores in the thousands and one taken while moving
 * scores in the tens. Computed by hand on a reduced greyscale copy rather than
 * with sharp's own `convolve`, because that writes back to an unsigned byte and
 * clamps every negative lobe of the kernel to zero — which is most of the
 * signal.
 */
async function laplacianVariance(input: Buffer): Promise<number> {
  const { sharp } = load();
  const width = 512;
  const { data, info } = await sharp(input)
    .greyscale()
    .resize({ width, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (w < 3 || h < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const value =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += value;
      sumSquares += value * value;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSquares / n - mean * mean;
}

/** What one image gave us, before anything decides what it means. */
export interface ImageRead {
  text: string;
  /** Tesseract's own mean confidence in its words, 0–100. */
  ocrConfidence: number;
  sharpness: number;
  /**
   * The image has no usable detail left at all — from the optics alone, NEVER
   * from how much text came off it.
   *
   * Those were one field once, and it was wrong in a way that mattered: a
   * perfectly sharp selfie has no text on it, so Tesseract reports about 35%
   * confidence on the noise it hallucinates out of a face, and the photograph
   * was marked unreadable. That is a `document_illegible` reason on every
   * single honest applicant — enough, with one more weak signal, to carry an
   * application past the auto-reject line.
   *
   * It is deliberately a very low bar; see IMAGE_DESTROYED_BELOW for why a
   * sharper one cannot work. Legibility is decided per slot instead.
   */
  blurred: boolean;
  /** Whether there is enough text, read confidently enough, to rely on. */
  textTrusted: boolean;
  width: number;
  height: number;
}

/**
 * Read the text off one image.
 *
 * Greyscaled and contrast-normalised before Tesseract sees it, which is worth
 * several points of confidence on the cards this engine was written for: a CNIC
 * photographed indoors is low-contrast dark text on a pale security pattern.
 */
export async function readImageText(input: Buffer): Promise<ImageRead | null> {
  if (input.byteLength > MAX_IMAGE_BYTES) {
    logger.warn('Local vision: image too large to read', { bytes: input.byteLength });
    return null;
  }
  const worker = await startOcr();
  if (!worker) return null;

  const { sharp } = load();
  try {
    const meta = await sharp(input).metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const target = Math.min(OCR_MAX_EDGE, Math.max(OCR_MIN_EDGE, longEdge));

    const prepared = await sharp(input)
      .rotate() // Honour the EXIF orientation; a sideways card reads as nothing.
      .greyscale()
      .resize({
        width: (meta.width ?? 0) >= (meta.height ?? 0) ? target : undefined,
        height: (meta.height ?? 0) > (meta.width ?? 0) ? target : undefined,
        fit: 'inside',
      })
      .normalise()
      .png()
      .toBuffer();

    const sharpness = await laplacianVariance(input);

    const run = ocrQueue.then(() => worker.recognize(prepared));
    ocrQueue = run.catch(() => undefined);
    const { data } = await run;

    const text = data.text ?? '';
    const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
    return {
      text,
      ocrConfidence: confidence,
      sharpness,
      blurred: sharpness < IMAGE_DESTROYED_BELOW,
      textTrusted: confidence >= OCR_CONFIDENCE_FLOOR && textDensity(text) >= MIN_DOCUMENT_WORDS,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch (e) {
    logger.error('Local vision: could not read text', { e });
    return null;
  }
}

// ── Faces ────────────────────────────────────────────────────────────────────

/** What one face gave us. */
export interface FaceRead {
  /** The 128 numbers two faces are compared by. */
  descriptor: Float32Array;
  geometry: FaceGeometry | null;
  /** The expression model's probability that this face is smiling. */
  smileProbability: number;
  /** The detector's own confidence that this is a face at all. */
  score: number;
  /** How much of the frame the face fills — a selfie should be most of it. */
  coverage: number;
}

/**
 * Find the one face in an image and measure it.
 *
 * `detectSingleFace` returns the most confident detection, which is the right
 * one here for both jobs: a selfie should contain one person, and on a CNIC the
 * printed portrait is the only face there is.
 *
 * Returns null when there is no face. That is a fact worth having — a licence
 * slot with no face in it is a licence slot with something else in it — and it
 * is never read as a pass anywhere.
 */
export async function readFace(input: Buffer): Promise<FaceRead | null> {
  if (input.byteLength > MAX_IMAGE_BYTES) return null;
  if (!(await loadModels())) return null;

  const { sharp, tf, faceapi } = load();
  try {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: FACE_MAX_EDGE, height: FACE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    /**
     * A fresh tensor per attempt, and never one shared between them.
     *
     * The two passes used to run against a single tensor, and the results were
     * order-dependent: the same card came back with a face on one run and
     * without one on the next, depending on what had been examined before it.
     * face-api takes ownership of what it is handed, so the second pass was
     * reading a tensor the first had already disposed. One allocation is a
     * cheap price for an answer that does not depend on history.
     */
    const look = async (inputSize: number) => {
      const tensor: TF.Tensor3D = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
      try {
        return await faceapi
          .detectSingleFace(
            tensor,
            new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: DETECTOR_SCORE }),
          )
          .withFaceLandmarks()
          .withFaceExpressions()
          .withFaceDescriptor();
      } finally {
        // Idempotent, so it is safe whether or not face-api already took it.
        // The WASM backend does not collect tensors, and an instance that
        // leaks one per image dies of memory exhaustion after a few hundred.
        tf.dispose(tensor);
      }
    };

    const found = (await look(DETECTOR_INPUT)) ?? (await look(DETECTOR_INPUT_FINE));
    if (!found) return null;

    const landmarks = found.landmarks;
    const geometry = measureFaceGeometry({
      leftEye: landmarks.getLeftEye(),
      rightEye: landmarks.getRightEye(),
      nose: landmarks.getNose(),
      mouth: landmarks.getMouth(),
      jaw: landmarks.getJawOutline(),
    });

    const box = found.detection.box;
    return {
      descriptor: found.descriptor,
      geometry,
      smileProbability: found.expressions.happy,
      score: found.detection.score,
      coverage: (box.width * box.height) / Math.max(1, info.width * info.height),
    };
  } catch (e) {
    logger.error('Local vision: could not read a face', { e });
    return null;
  }
}

/** How far apart two faces are. Lower is more alike; see FACE_SAME_PERSON_BELOW. */
export function faceDistance(a: Float32Array | null, b: Float32Array | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  const d = load().faceapi.euclideanDistance(a, b);
  return Number.isFinite(d) ? d : null;
}

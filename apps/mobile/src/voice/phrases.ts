/**
 * What the app says out loud.
 *
 * Urdu, not English, and not because of a language setting — this flow exists
 * for people who cannot read the screen, and Urdu is the language nearly all of
 * them share regardless of mother tongue. Every line is also rendered on screen
 * for everyone else.
 *
 * On prices: the fares quoted here are the STARTING fares from BASE_FARES, and
 * every line says so ("se shuru"). The voice layer has no distance to work
 * from — it deliberately never geocodes — so it cannot know the real fare, and
 * quoting one it invented would be a lie with money attached. The exact figure
 * is computed by the fare engine on the booking screen, which is the last thing
 * the user sees before anything is booked.
 */
import { BASE_FARES, RIDE_TYPE_LABELS, type RideType } from '../domain/types';

/** Ride types offered by voice, cheapest first. */
export const VOICE_RIDE_OPTIONS: readonly RideType[] = ['auto', 'mini', 'ac'];

/** Urdu names for the vehicle types, for speaking aloud. */
const RIDE_NAMES_UR: Record<RideType, string> = {
  bike: 'بائیک',
  auto: 'رکشہ',
  mini: 'چھوٹی گاڑی',
  ac: 'اے سی گاڑی',
  comfort: 'آرام دہ گاڑی',
  xl: 'بڑی گاڑی',
};

export function rideNameUr(rideType: RideType): string {
  return RIDE_NAMES_UR[rideType] ?? RIDE_TYPE_LABELS[rideType];
}

export const GREETING = 'بتائیں، کہاں جانا ہے؟';

export const NOT_UNDERSTOOD = 'معاف کیجیے، سمجھ نہیں آیا۔ دوبارہ بولیں۔';

export const ASK_DESTINATION = 'کہاں جانا ہے؟';

export const NO_PERMISSION =
  'مائیک کی اجازت نہیں ملی۔ آپ لکھ کر بھی رائیڈ بک کر سکتے ہیں۔';

export const NOT_AVAILABLE =
  'اس فون میں آواز کی سہولت موجود نہیں۔ آپ لکھ کر رائیڈ بک کر سکتے ہیں۔';

export const CANCELLED = 'ٹھیک ہے، رہنے دیا۔';

/**
 * The vehicle question. Only two or three options are ever read out — a spoken
 * list of six is unusable, because by the fourth the listener has lost the
 * first.
 */
export function askRideType(options: readonly RideType[] = VOICE_RIDE_OPTIONS): string {
  const parts = options.map(
    (rideType) => `${rideNameUr(rideType)}، ${BASE_FARES[rideType]} روپے سے شروع`,
  );
  return `کون سی گاڑی چاہیے؟ ${parts.join('۔ ')}۔`;
}

/** Spoken note that a pool fare starts full and falls as riders join. */
export const POOL_NOTE =
  'پول میں ابھی پورا کرایہ لگے گا، جیسے جیسے لوگ شامل ہوں گے کم ہوتا جائے گا۔';

/** The final read-back before anything is booked. */
export function confirmLine(params: {
  destination: string;
  rideType: RideType;
  pool: boolean;
  seats: number;
}): string {
  const bits = [rideNameUr(params.rideType), params.destination];
  if (params.pool) bits.push('پول رائیڈ');
  if (params.seats > 1) bits.push(`${params.seats} لوگ`);

  return `${bits.join('، ')}۔ آگے بڑھیں؟`;
}

/** Confirmation echoed on screen in English, for readers. */
export function confirmLineEn(params: {
  destination: string;
  rideType: RideType;
  pool: boolean;
  seats: number;
}): string {
  const bits = [RIDE_TYPE_LABELS[params.rideType], `to ${params.destination}`];
  if (params.pool) bits.push('pool ride');
  if (params.seats > 1) bits.push(`${params.seats} passengers`);
  return bits.join(' · ');
}

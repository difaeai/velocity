/**
 * The username rules, on the app's side of the wire.
 *
 * A copy of `normalizeUsername` in backend/functions/src/fleet/index.ts, and
 * it has to stay one: the screen tells you a name is free WHILE YOU TYPE, and
 * a rule the keyboard accepts but the server refuses turns that promise into
 * an error on the last tap. The backend test pins the shared behaviour.
 *
 * Three to seven characters. Special characters are allowed — what is refused
 * is only what would break a Firestore document path.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 7;

export type UsernameCheck =
  | { ok: true; username: string; slug: string }
  | { ok: false; reason: string };

export function checkUsername(raw: string): UsernameCheck {
  const username = raw.trim();
  // Code points, not UTF-16 units, so one emoji counts as one character.
  const length = [...username].length;
  if (length < USERNAME_MIN) return { ok: false, reason: `At least ${USERNAME_MIN} characters.` };
  if (length > USERNAME_MAX) return { ok: false, reason: `At most ${USERNAME_MAX} characters.` };
  if (/[\s/\u0000-\u001f\u007f]/.test(username)) {
    return { ok: false, reason: 'No spaces or slashes.' };
  }
  if (username === '.' || username === '..' || /^__.*__$/.test(username)) {
    return { ok: false, reason: 'That username is reserved.' };
  }
  return { ok: true, username, slug: username.toLowerCase() };
}

/**
 * Local "this account has a username" flag.
 *
 * Same trick as `onboarding_done_*`: once claimed, the entry route must not
 * spend a Firestore read on every cold start to find that out, and a read
 * failure must never trap somebody on the username screen.
 */
export function usernameDoneKey(uid: string): string {
  return `username_set_${uid}`;
}

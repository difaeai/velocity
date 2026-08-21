/**
 * The phone mockups, built as real UI rather than flattened images.
 *
 * Everything here is laid out at a nominal 360×780 phone and scaled down by the
 * frame, so the type stays crisp on any display, the screens restyle with the
 * rest of the site, and the whole set costs a few kilobytes instead of four
 * 1080×1920 PNGs.
 *
 * The palette matches the shipped Android app: near-black surfaces, lime
 * (#CCFF00) as the single action colour.
 */
import type { ReactNode } from 'react';

import { BadgeCheck, Banknote, MapPin, Navigation, Shield, Users } from './Icons';
import s from './screens.module.css';

/* ── shared chrome ─────────────────────────────────────────────────────── */

function StatusBar({ dark = true }: { dark?: boolean }) {
  return (
    <div className={`${s.status} ${dark ? '' : s.statusLight}`} aria-hidden="true">
      <span className={s.clock}>9:41</span>
      <span className={s.statusIcons}>
        <svg viewBox="0 0 20 12" className={s.bars}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="4.5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="9" y="3" width="3" height="9" rx="1" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" className={s.wifi}>
          <path d="M8 10.6 5.6 8.2a3.4 3.4 0 0 1 4.8 0L8 10.6Z" />
          <path d="M8 6.2a6.4 6.4 0 0 0-4.5 1.9L2 6.6a8.5 8.5 0 0 1 12 0l-1.5 1.5A6.4 6.4 0 0 0 8 6.2Z" />
        </svg>
        <span className={s.battery}>
          <span />
        </span>
      </span>
    </div>
  );
}

/** A stylised city map: blocks, a river, the route, and the two pins. */
function MiniMap({
  variant = 'route',
  className = '',
}: {
  variant?: 'route' | 'trip' | 'pool';
  className?: string;
}) {
  return (
    <svg viewBox="0 0 360 420" className={`${s.map} ${className}`} aria-hidden="true">
      <rect width="360" height="420" fill="#0d1310" />
      <g fill="#141c18">
        <rect x="-10" y="18" width="120" height="86" rx="6" />
        <rect x="128" y="10" width="96" height="70" rx="6" />
        <rect x="244" y="24" width="130" height="94" rx="6" />
        <rect x="-10" y="126" width="94" height="120" rx="6" />
        <rect x="104" y="102" width="118" height="96" rx="6" />
        <rect x="244" y="140" width="130" height="86" rx="6" />
        <rect x="-10" y="268" width="140" height="110" rx="6" />
        <rect x="152" y="220" width="70" height="158" rx="6" />
        <rect x="244" y="248" width="130" height="130" rx="6" />
        <rect x="-10" y="398" width="380" height="40" rx="6" />
      </g>
      {/* a park and a strip of water for colour variation */}
      <rect x="104" y="102" width="118" height="96" rx="6" fill="#15281d" />
      <path d="M0 236 C 80 226 130 250 200 240 C 270 230 320 246 372 238 L 372 262 C 320 270 270 254 200 264 C 130 274 80 250 0 260 Z" fill="#122a33" />

      <g stroke="#0a0f0d" strokeWidth="3" opacity=".9">
        <path d="M114 -10 V430 M232 -10 V430 M-10 112 H370 M-10 256 H370" />
      </g>

      {variant === 'trip' ? (
        <>
          <path d="M84 330 C 84 268 150 250 168 196 C 186 142 240 132 286 118" className={s.routeGlow} />
          <path d="M84 330 C 84 268 150 250 168 196 C 186 142 240 132 286 118" className={s.route} />
          <g className={s.carDot} transform="translate(168 196)">
            <circle r="17" className={s.carHalo} />
            <circle r="11" fill="#ccff00" />
            <path d="M-4.5 2.5 L0 -6 L4.5 2.5 L0 0.2 Z" fill="#0d1310" />
          </g>
          <Pin x={286} y={118} tone="lime" />
          <Pin x={84} y={330} tone="white" />
        </>
      ) : (
        <>
          <path d="M96 322 C 96 256 158 244 176 190 C 194 136 246 126 292 112" className={s.routeGlow} />
          <path d="M96 322 C 96 256 158 244 176 190 C 194 136 246 126 292 112" className={s.route} />
          <Pin x={96} y={322} tone="lime" />
          <Pin x={292} y={112} tone="white" />
        </>
      )}

      {variant === 'pool' ? (
        <>
          <circle cx="150" cy="272" r="9" className={s.riderDot} />
          <circle cx="228" cy="176" r="9" className={s.riderDot} />
          <circle cx="196" cy="330" r="9" className={s.riderDot} />
        </>
      ) : null}
    </svg>
  );
}

function Pin({ x, y, tone }: { x: number; y: number; tone: 'lime' | 'white' }) {
  const fill = tone === 'lime' ? '#ccff00' : '#ffffff';
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="2" rx="9" ry="3.5" fill="#000" opacity=".45" />
      <path d="M0 0 C -9 -12 -13 -17 -13 -23 A13 13 0 1 1 13 -23 C 13 -17 9 -12 0 0Z" fill={fill} />
      <circle cy="-23" r="5" fill="#0d1310" />
    </g>
  );
}

function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`${s.sheet} ${className}`}>
      <span className={s.grabber} aria-hidden="true" />
      {children}
    </div>
  );
}

function Avatar({ initials, tone = 0 }: { initials: string; tone?: number }) {
  const tones = ['#1f6f4b', '#3b5f8a', '#7a5230', '#5c3f77'];
  return (
    <span className={s.avatar} style={{ background: tones[tone % tones.length] }} aria-hidden="true">
      {initials}
    </span>
  );
}

/* ── screen 1: booking ─────────────────────────────────────────────────── */

export function ScreenBook() {
  return (
    <div className={s.screen}>
      <StatusBar />
      <div className={s.mapWrap}>
        <MiniMap />
        <div className={s.mapTop}>
          <span className={s.greet}>Where to, Ayesha?</span>
        </div>
      </div>

      <Sheet>
        <div className={s.field}>
          <span className={s.fieldIcon}>
            <MapPin />
          </span>
          <span>
            <small>Pickup</small>
            <b>Model Town, Block C</b>
          </span>
        </div>
        <div className={`${s.field} ${s.fieldActive}`}>
          <span className={`${s.fieldIcon} ${s.fieldIconLime}`}>
            <Navigation />
          </span>
          <span>
            <small>Destination</small>
            <b>Packages Mall</b>
          </span>
        </div>

        <div className={s.segment} role="presentation">
          <span className={s.segOn}>Solo</span>
          <span>Pool · save 60%</span>
        </div>

        <div className={s.fareRow}>
          <span>
            <small>Your fare</small>
            <b className={s.fareBig}>Rs 480</b>
          </span>
          <span className={s.stepper}>
            <i>−</i>
            <i>+</i>
          </span>
        </div>

        <button type="button" className={s.cta} tabIndex={-1}>
          Find a driver
        </button>
      </Sheet>
    </div>
  );
}

/* ── screen 2: pool matching ───────────────────────────────────────────── */

export function ScreenPool() {
  return (
    <div className={s.screen}>
      <StatusBar />
      <div className={`${s.mapWrap} ${s.mapWrapShort}`}>
        <MiniMap variant="pool" />
      </div>

      <Sheet className={s.sheetTall}>
        <p className={s.sheetTitle}>3 riders going your way</p>
        <div className={s.avatarRow}>
          <Avatar initials="AK" tone={0} />
          <Avatar initials="SR" tone={1} />
          <Avatar initials="MH" tone={2} />
          <span className={s.avatarMore}>+ you</span>
        </div>

        <div className={s.saveCard}>
          <span>
            <small>You pay</small>
            <b className={s.fareBig}>Rs 192</b>
            <em>was Rs 480 solo</em>
          </span>
          <span className={s.saveBadge}>−60%</span>
        </div>

        <ul className={s.ticks}>
          <li>
            <Users />
            Everyone verified with CNIC
          </li>
          <li>
            <Shield />
            Women-only pools available
          </li>
        </ul>

        <button type="button" className={s.cta} tabIndex={-1}>
          Join this pool
        </button>
      </Sheet>
    </div>
  );
}

/* ── screen 3: live trip ───────────────────────────────────────────────── */

export function ScreenTrip() {
  return (
    <div className={s.screen}>
      <StatusBar />
      <div className={s.mapWrap}>
        <MiniMap variant="trip" />
        <div className={s.mapTop}>
          <span className={s.etaPill}>
            <b>4 min</b> away · arriving 9:45
          </span>
        </div>
        <button type="button" className={s.sos} tabIndex={-1}>
          SOS
        </button>
      </div>

      <Sheet>
        <div className={s.driver}>
          <Avatar initials="IK" tone={2} />
          <span className={s.driverInfo}>
            <b>Imran K.</b>
            <small>
              <span className={s.star}>★</span> 4.9 · 2,140 trips
            </small>
          </span>
          <span className={s.plate}>LEB-4417</span>
        </div>
        <p className={s.carLine}>Silver Toyota Corolla · Arriving at Block C gate</p>

        <div className={s.actions}>
          <span className={s.action}>Call</span>
          <span className={s.action}>Message</span>
          <span className={`${s.action} ${s.actionLime}`}>Share trip</span>
        </div>
      </Sheet>
    </div>
  );
}

/* ── screen 4: Earn with Velocity ──────────────────────────────────────── */

export function ScreenEarn() {
  const bars = [38, 52, 30, 64, 48, 74, 92];
  return (
    <div className={`${s.screen} ${s.screenPlain}`}>
      <StatusBar />
      <div className={s.earnHead}>
        <span>
          <small>Earn with Velocity</small>
          <b>Your fleet</b>
        </span>
        <span className={s.proBadge}>PRO</span>
      </div>

      <div className={s.earnHero}>
        <small>Earned this month</small>
        <b>Rs 18,420</b>
        <span className={s.earnDelta}>▲ 24% vs last month</span>
        <div className={s.spark} aria-hidden="true">
          {bars.map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className={s.statRow}>
        <span>
          <b>24</b>
          <small>Drivers</small>
        </span>
        <span>
          <b>186</b>
          <small>Riders</small>
        </span>
        <span>
          <b>2%</b>
          <small>Of commission</small>
        </span>
      </div>

      <div className={s.codeCard}>
        <span>
          <small>Your fleet code</small>
          <b>48213</b>
        </span>
        <span className={s.copyBtn}>Copy</span>
      </div>

      <ul className={s.feed}>
        <li>
          <Avatar initials="RA" tone={0} />
          <span>
            <b>Rashid A.</b>
            <small>completed 6 rides</small>
          </span>
          <em>+Rs 74</em>
        </li>
        <li>
          <Avatar initials="NF" tone={3} />
          <span>
            <b>Nadia F.</b>
            <small>joined your rider fleet</small>
          </span>
          <em>+Rs 12</em>
        </li>
      </ul>
    </div>
  );
}

/* ── screen 5: cash payment ────────────────────────────────────────────── */

export function ScreenCash() {
  return (
    <div className={`${s.screen} ${s.screenPlain}`}>
      <StatusBar />
      <div className={s.doneWrap}>
        <span className={s.doneTick} aria-hidden="true">
          <BadgeCheck />
        </span>
        <p className={s.doneTitle}>You&apos;ve arrived</p>
        <p className={s.doneSub}>Model Town → Packages Mall · 22 min</p>
      </div>

      <div className={s.receipt}>
        <span>
          <small>Trip fare</small>
          <b>Rs 480</b>
        </span>
        <span>
          <small>Pool discount</small>
          <b className={s.neg}>− Rs 288</b>
        </span>
        <span>
          <small>Promo VELOCITY50</small>
          <b className={s.neg}>− Rs 20</b>
        </span>
        <span className={s.total}>
          <small>Pay the driver</small>
          <b className={s.fareBig}>Rs 172</b>
        </span>
      </div>

      <div className={s.payRow}>
        <span className={s.payOn}>
          <Banknote />
          Cash
        </span>
        <span className={s.payOff}>Wallet</span>
      </div>
      <p className={s.payNote}>No card needed. Hand over the fare and you&apos;re done.</p>

      <div className={s.rate}>
        <small>Rate Imran K.</small>
        <span className={s.stars}>★★★★★</span>
      </div>

      <button type="button" className={s.cta} tabIndex={-1}>
        Done
      </button>
    </div>
  );
}

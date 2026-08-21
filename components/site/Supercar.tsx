/**
 * The scroll-driven supercar — a hand-built SVG, not an image, so the wheels can
 * spin, the brakes can glow and the whole thing stays crisp at any width for a
 * few kilobytes.
 *
 * Animated parts read CSS custom properties set by <SpeedStage>:
 *   --spin      wheel rotation, in degrees (accumulates)
 *   --blur      0→1 wheel motion-blur mix
 *   --heat      0→1 exhaust / brake glow
 *
 * `idPrefix` keeps the gradient ids unique when more than one car is on a page.
 */
import styles from './supercar.module.css';

const SPOKES = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

/** Silhouette shared by the paint fill, the clip for surface detail, and the rim light. */
const SHELL =
  'M 916 230 C 914 216 906 206 892 198 L 856 176 C 838 158 812 146 780 145 ' +
  'C 748 145 724 156 710 174 C 700 186 690 190 676 191 L 654 192 L 560 118 ' +
  'C 546 107 530 102 512 102 L 424 102 C 402 102 387 109 374 124 L 332 156 ' +
  'C 314 146 290 141 262 142 C 232 143 208 151 192 161 L 134 172 ' +
  'C 116 175 104 179 96 187 L 90 198 L 86 234 C 85 249 91 257 102 260 L 152 264 ' +
  'L 830 262 C 862 261 884 260 896 258 C 910 255 916 246 916 234 Z';

/** Top edge only — carries the lime rim light. */
const CREST =
  'M 892 198 L 856 176 C 838 158 812 146 780 145 C 748 145 724 156 710 174 ' +
  'C 700 186 690 190 676 191 L 654 192 L 560 118 C 546 107 530 102 512 102 ' +
  'L 424 102 C 402 102 387 109 374 124 L 332 156 C 314 146 290 141 262 142 ' +
  'C 232 143 208 151 192 161 L 134 172 C 116 175 104 179 96 187 L 90 198';

function Wheel({ cx, prefix }: { cx: number; prefix: string }) {
  return (
    <g>
      <circle cx={cx} cy={238} r={62} fill="#0a0e0c" />
      <circle cx={cx} cy={238} r={58} fill="none" stroke="#1b221e" strokeWidth={7} />
      {/* brake disc, glowing under hard use */}
      <circle cx={cx} cy={238} r={34} fill="#0d120f" />
      <circle
        className={styles.brake}
        cx={cx}
        cy={238}
        r={34}
        fill="none"
        stroke="#ff7a1a"
        strokeWidth={5}
      />
      <g className={styles.rim} style={{ transformOrigin: `${cx}px 238px` }}>
        <circle cx={cx} cy={238} r={46} fill="#121714" />
        <circle cx={cx} cy={238} r={33} fill="#080b09" stroke="#232b26" strokeWidth={4} />
        {SPOKES.map((deg) => (
          <path
            key={deg}
            d="M -5.5 -14 L -8 -43.5 L 8 -43.5 L 5.5 -14 Z"
            fill={`url(#${prefix}-spoke)`}
            transform={`translate(${cx} 238) rotate(${deg})`}
          />
        ))}
        <circle cx={cx} cy={238} r={12} fill="#ccff00" />
        <circle cx={cx} cy={238} r={4.5} fill="#080b09" />
      </g>
      {/* motion smear that cross-fades in over the spokes at speed — far cheaper
          than an SVG blur filter running every frame */}
      <g className={styles.smear}>
        <circle cx={cx} cy={238} r={44} fill="none" stroke="#c8d4ce" strokeWidth={3} opacity={0.5} />
        <circle cx={cx} cy={238} r={36} fill="none" stroke="#9fb0a7" strokeWidth={4} opacity={0.4} />
        <circle cx={cx} cy={238} r={26} fill="none" stroke="#7d8d85" strokeWidth={5} opacity={0.3} />
      </g>
    </g>
  );
}

export function Supercar({ idPrefix = 'car', className }: { idPrefix?: string; className?: string }) {
  const p = idPrefix;
  return (
    <svg
      viewBox="0 0 1000 320"
      className={className}
      role="img"
      aria-label="A green Velocity supercar in side profile, accelerating"
    >
      <defs>
        <linearGradient id={`${p}-paint`} x1=".15" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#33d986" />
          <stop offset=".22" stopColor="#12ab62" />
          <stop offset=".5" stopColor="#057444" />
          <stop offset=".78" stopColor="#02502e" />
          <stop offset="1" stopColor="#012b19" />
        </linearGradient>
        <linearGradient id={`${p}-low`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id={`${p}-glass`} x1=".2" y1="0" x2=".85" y2="1">
          <stop offset="0" stopColor="#274035" />
          <stop offset=".5" stopColor="#0b120f" />
          <stop offset="1" stopColor="#040706" />
        </linearGradient>
        <linearGradient id={`${p}-rimlight`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ccff00" stopOpacity=".2" />
          <stop offset=".3" stopColor="#ccff00" stopOpacity=".95" />
          <stop offset=".75" stopColor="#ccff00" stopOpacity=".45" />
          <stop offset="1" stopColor="#ccff00" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${p}-spoke`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f7f4" />
          <stop offset="1" stopColor="#8b9a93" />
        </linearGradient>
        <radialGradient id={`${p}-contact`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".85" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${p}-flame`} cx=".85" cy=".5" r=".7">
          <stop offset="0" stopColor="#fff6d0" />
          <stop offset=".35" stopColor="#ffb020" />
          <stop offset="1" stopColor="#ff5a00" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${p}-shell`}>
          <path d={SHELL} />
        </clipPath>
        <clipPath id={`${p}-ground`}>
          <rect x="0" y="0" width="1000" height="300" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${p}-ground)`}>
        <ellipse cx="500" cy="294" rx="410" ry="24" fill={`url(#${p}-contact)`} />

        {/* exhaust flare, only visible when --heat rises */}
        <ellipse className={styles.flame} cx="52" cy="236" rx="66" ry="15" fill={`url(#${p}-flame)`} />

        {/* wheel wells sit behind the paint */}
        <circle cx="262" cy="238" r="76" fill="#040705" />
        <circle cx="760" cy="238" r="76" fill="#040705" />

        {/* swan-neck rear wing */}
        <path d="M 136 164 L 142 150 L 152 150 L 148 166 Z" fill="#02371f" />
        <path d="M 200 158 L 206 145 L 216 145 L 212 160 Z" fill="#02371f" />
        <path d="M 98 152 C 140 142 194 137 246 136 L 248 151 C 196 152 142 158 100 168 Z" fill="#0a1310" />
        <path d="M 100 155 C 142 146 194 141 244 140 L 245 145 C 194 146 142 152 101 161 Z" fill="#ccff00" opacity=".5" />

        <path d={SHELL} fill={`url(#${p}-paint)`} />

        <g clipPath={`url(#${p}-shell)`}>
          <rect x="0" y="196" width="1000" height="120" fill={`url(#${p}-low)`} />
          {/* cabin shadow */}
          <path
            d="M 654 192 L 560 118 C 546 107 530 102 512 102 L 424 102 C 402 102 387 109 374 124 L 332 156 C 386 178 476 190 654 192 Z"
            fill="#000"
            opacity=".2"
          />
          {/* fender highlights */}
          <path
            d="M 856 176 C 838 158 812 146 780 146 C 750 146 728 158 714 176 L 722 180 C 736 165 754 156 780 156 C 808 156 830 168 848 184 Z"
            fill="#fff"
            opacity=".14"
          />
          <path
            d="M 332 156 C 314 146 290 141 262 142 C 232 143 208 151 192 161 L 196 168 C 214 158 236 150 264 149 C 290 148 312 153 328 162 Z"
            fill="#fff"
            opacity=".14"
          />
          {/* mid-engine side intake */}
          <path d="M 300 176 C 336 190 366 198 392 202 L 384 226 C 350 220 318 208 288 192 Z" fill="#040706" />
          <path d="M 306 183 C 338 194 364 201 386 205 L 384 212 C 358 208 330 200 302 190 Z" fill="#ccff00" opacity=".3" />
          {/* door shut line */}
          <path d="M 652 194 C 610 208 578 220 556 232 L 560 256" fill="none" stroke="#00301f" strokeWidth={2.5} opacity=".6" />
          {/* character blade: white with a lime pinstripe */}
          <path
            d="M 150 210 C 330 242 540 244 700 218 C 756 209 800 196 832 180 L 836 192 C 802 210 758 224 702 234 C 540 258 330 256 148 224 Z"
            fill="#fff"
            opacity=".95"
          />
          <path d="M 150 230 C 330 260 540 258 698 236 L 697 243 C 540 264 330 262 149 236 Z" fill="#ccff00" opacity=".9" />
          {/* rocker + diffuser shadow */}
          <path d="M 330 256 L 700 258 L 700 272 L 330 268 Z" fill="#030605" opacity=".95" />
          <path d="M 86 232 L 128 236 L 128 262 L 88 258 Z" fill="#050d09" opacity=".9" />
        </g>

        {/* splitter + diffuser */}
        <path d="M 828 254 C 862 254 886 250 900 242 L 908 252 C 892 264 862 268 832 267 Z" fill="#050d09" />
        <path d="M 92 244 L 206 256 L 206 266 L 104 262 Z" fill="#050d09" />

        {/* headlight */}
        <path d="M 852 180 C 872 190 890 200 904 212 L 896 224 C 882 212 864 202 844 192 Z" fill="#faffe8" />
        <path d="M 855 186 C 872 195 887 204 899 214 L 896 218 C 883 208 868 200 851 192 Z" fill="#ccff00" />
        {/* tail light bar */}
        <path d="M 88 198 L 136 202 L 136 216 L 87 212 Z" fill="#ccff00" />
        <path d="M 93 203 L 130 206 L 130 211 L 92 208 Z" fill="#fff" opacity=".75" />
        {/* wing mirror */}
        <path d="M 646 150 C 660 145 672 148 676 157 L 654 161 Z" fill="#02371f" />

        {/* glass */}
        <path
          d="M 654 190 L 564 120 C 550 110 534 106 516 106 L 426 106 C 406 106 392 113 379 127 L 342 154 C 424 178 524 188 654 190 Z"
          fill={`url(#${p}-glass)`}
        />
        <path d="M 562 124 L 644 188 L 614 187 L 538 128 Z" fill="#fff" opacity=".12" />
        <path d="M 428 110 L 502 110 L 406 150 L 374 138 Z" fill="#fff" opacity=".08" />

        <path d={CREST} fill="none" stroke={`url(#${p}-rimlight)`} strokeWidth={3} strokeLinecap="round" />

        <Wheel cx={262} prefix={p} />
        <Wheel cx={760} prefix={p} />
      </g>
    </svg>
  );
}

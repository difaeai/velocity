/**
 * The scroll-driven supercar — a hand-built SVG, not an image, so the wheels can
 * spin, the brakes can glow and the whole thing stays crisp at any width for a
 * few kilobytes.
 *
 * The shading is what makes it read as a rendered car rather than an
 * illustration. In profile, glossy paint is a mirror: the crown reflects the
 * sky (bright), the flank falls into shade, and where the panel turns through
 * horizontal there is a hard bright band reflecting the horizon, with the
 * ground reflected dark below it. That dark → bright → dark run down the
 * `paint` gradient is doing most of the work; the rest is ambient occlusion
 * around the arches and under the sills, plus light bouncing back up off the
 * tarmac.
 *
 * Animated parts read CSS custom properties set by <SpeedStage>:
 *   --spin      wheel rotation, in degrees (accumulates)
 *   --blur      0→1 wheel motion-blur mix
 *   --heat      0→1 exhaust / brake glow
 *
 * `idPrefix` keeps the gradient ids unique when more than one car is on a page.
 */
import styles from './supercar.module.css';

const SPOKES = [0, 51.4, 102.8, 154.2, 205.7, 257.1, 308.5];

/** Silhouette, shared by the paint fill, the detail clip and the reflection. */
const SHELL =
  'M 916 230 C 914 216 906 206 892 198 L 856 176 ' +
  'C 838 158 812 146 780 145 C 748 145 724 156 710 174 C 700 186 690 190 676 191 ' +
  'L 654 192 L 560 118 C 546 107 530 102 512 102 L 424 102 C 402 102 387 109 374 124 ' +
  'L 332 156 C 314 146 290 141 262 142 C 232 143 208 151 192 161 L 134 172 ' +
  'C 116 175 104 179 96 187 L 90 198 L 86 234 C 85 249 91 257 102 260 L 152 264 ' +
  'L 830 262 C 862 261 884 260 896 258 C 910 255 916 246 916 234 Z';

function Wheel({ cx, offset, prefix }: { cx: number; offset: number; prefix: string }) {
  const p = prefix;
  return (
    <g>
      <circle cx={cx} cy={238} r={65} fill={`url(#${p}-tyre)`} />
      {/* light catching the top of the sidewall */}
      <path
        d={`M ${cx} 238 m -60 0 a 60 60 0 0 1 88 -50`}
        fill="none"
        stroke="#6b7772"
        strokeWidth={4}
        opacity={0.4}
      />
      <circle cx={cx} cy={238} r={57} fill="none" stroke="#000" strokeWidth={5} opacity={0.5} />
      <circle cx={cx} cy={238} r={48} fill={`url(#${p}-rimwell)`} />

      {/* brake disc and caliper live behind the spokes and glow under load */}
      <circle cx={cx} cy={238} r={31} fill="#0b100e" />
      <path
        d={`M ${cx} 238 m -26 0 a 26 26 0 0 1 36 -23`}
        fill="none"
        stroke="#8c3a12"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        className={styles.brake}
        d={`M ${cx} 238 m -26 0 a 26 26 0 0 1 36 -23`}
        fill="none"
        stroke="#ff7a2a"
        strokeWidth={7}
        strokeLinecap="round"
      />

      <g className={styles.rim} style={{ transformOrigin: `${cx}px 238px` }}>
        <circle cx={cx} cy={238} r={46.5} fill="none" stroke="#dfe7e3" strokeWidth={3.5} />
        <circle cx={cx} cy={238} r={43} fill="none" stroke="#000" strokeWidth={1.5} opacity={0.5} />
        {SPOKES.map((deg) => (
          <path
            key={deg}
            d="M -6 -16 L -9.5 -42 L 9.5 -42 L 6 -16 Z"
            fill={`url(#${p}-rimface)`}
            transform={`translate(${cx} 238) rotate(${deg + offset})`}
          />
        ))}
        <circle cx={cx} cy={238} r={14} fill="#1b221f" />
        <circle cx={cx} cy={238} r={9} fill="#ccff00" />
        <circle cx={cx} cy={238} r={3} fill="#0b100e" />
      </g>

      {/* Spinning spokes read as concentric smear, not as spokes. Cross-fading
          rings costs a fraction of an SVG blur filter running every frame. */}
      <g className={styles.smear}>
        <circle cx={cx} cy={238} r={44} fill="none" stroke="#c8d4ce" strokeWidth={4} opacity={0.55} />
        <circle cx={cx} cy={238} r={36} fill="none" stroke="#8e9c95" strokeWidth={5} opacity={0.45} />
        <circle cx={cx} cy={238} r={25} fill="none" stroke="#5f6b66" strokeWidth={6} opacity={0.35} />
      </g>
    </g>
  );
}

export function Supercar({ idPrefix = 'car', className }: { idPrefix?: string; className?: string }) {
  const p = idPrefix;
  return (
    <svg
      viewBox="0 0 1000 360"
      className={className}
      role="img"
      aria-label="A green Velocity supercar in side profile, accelerating"
    >
      <defs>
        <linearGradient id={`${p}-paint`} x1="0" y1="0.3" x2="0" y2="1">
          <stop offset="0" stopColor="#B6F5DB" />
          <stop offset=".05" stopColor="#5ADFA3" />
          <stop offset=".14" stopColor="#17A96B" />
          <stop offset=".27" stopColor="#067544" />
          <stop offset=".41" stopColor="#02452C" />
          <stop offset=".5" stopColor="#012D1D" />
          <stop offset=".545" stopColor="#0B7A4A" />
          <stop offset=".585" stopColor="#6BE8B0" />
          <stop offset=".6" stopColor="#9CF4CC" />
          <stop offset=".625" stopColor="#40C689" />
          <stop offset=".68" stopColor="#065B37" />
          <stop offset=".78" stopColor="#053A24" />
          <stop offset=".9" stopColor="#04291A" />
          <stop offset="1" stopColor="#072F1E" />
        </linearGradient>
        <linearGradient id={`${p}-lengthwise`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".42" />
          <stop offset=".2" stopColor="#000" stopOpacity=".14" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".03" />
          <stop offset=".88" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#fff" stopOpacity=".2" />
        </linearGradient>
        <radialGradient id={`${p}-archAO`} cx=".5" cy=".5" r=".5">
          <stop offset=".5" stopColor="#000" stopOpacity="0" />
          <stop offset=".62" stopColor="#000" stopOpacity=".62" />
          <stop offset=".78" stopColor="#000" stopOpacity=".28" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}-rockerAO`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".52" />
        </linearGradient>
        <linearGradient id={`${p}-bounce`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7FE3B4" stopOpacity=".3" />
          <stop offset=".45" stopColor="#7FE3B4" stopOpacity=".07" />
          <stop offset="1" stopColor="#7FE3B4" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${p}-spec`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".85" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}-glass`} x1=".1" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#54786A" />
          <stop offset=".2" stopColor="#182720" />
          <stop offset=".58" stopColor="#060A09" />
          <stop offset="1" stopColor="#0E1714" />
        </linearGradient>
        <linearGradient id={`${p}-tyre`} x1=".3" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#313935" />
          <stop offset=".3" stopColor="#191E1C" />
          <stop offset=".62" stopColor="#0B0E0D" />
          <stop offset="1" stopColor="#040606" />
        </linearGradient>
        <linearGradient id={`${p}-rimface`} x1=".25" y1="0" x2=".75" y2="1">
          <stop offset="0" stopColor="#F4F8F6" />
          <stop offset=".3" stopColor="#CBD5D0" />
          <stop offset=".62" stopColor="#8B968F" />
          <stop offset="1" stopColor="#454E49" />
        </linearGradient>
        <radialGradient id={`${p}-rimwell`} cx=".46" cy=".38" r=".64">
          <stop offset="0" stopColor="#333B37" />
          <stop offset=".6" stopColor="#121715" />
          <stop offset="1" stopColor="#050807" />
        </radialGradient>
        <radialGradient id={`${p}-contact`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".92" />
          <stop offset=".5" stopColor="#000" stopOpacity=".5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        {/* Fades away from the car in the flipped space, so no mask or filter
            has to run while the car is transforming every frame. */}
        <linearGradient id={`${p}-refl`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1FBE79" stopOpacity=".26" />
          <stop offset=".18" stopColor="#0A5537" stopOpacity=".08" />
          <stop offset=".45" stopColor="#04231A" stopOpacity="0" />
        </linearGradient>
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

      {/* wet-tarmac reflection, squashed the way a road reflection actually is */}
      <g transform="translate(0 397) scale(1 -0.325)">
        <path d={SHELL} fill={`url(#${p}-refl)`} />
      </g>

      <g clipPath={`url(#${p}-ground)`}>
        <ellipse cx="500" cy="297" rx="392" ry="17" fill={`url(#${p}-contact)`} />
        <ellipse cx="262" cy="299" rx="76" ry="12" fill="#000" opacity=".8" />
        <ellipse cx="760" cy="299" rx="76" ry="12" fill="#000" opacity=".8" />

        <ellipse className={styles.flame} cx="52" cy="230" rx="62" ry="14" fill={`url(#${p}-flame)`} />

        <circle cx="262" cy="238" r="80" fill="#020403" />
        <circle cx="760" cy="238" r="80" fill="#020403" />

        {/* swan-neck rear wing */}
        <path d="M 136 164 L 142 150 L 152 150 L 148 166 Z" fill="#0a3a29" />
        <path d="M 200 158 L 206 145 L 216 145 L 212 160 Z" fill="#0a3a29" />
        <path d="M 98 152 C 140 142 194 137 246 136 L 248 151 C 196 152 142 158 100 168 Z" fill="#16261f" />
        <path d="M 100 154 C 142 145 194 140 244 139 L 245 143 C 194 144 142 150 101 159 Z" fill="#a8e8c8" opacity=".4" />

        <path d={SHELL} fill={`url(#${p}-paint)`} />

        <g clipPath={`url(#${p}-shell)`}>
          <path d={SHELL} fill={`url(#${p}-lengthwise)`} />

          {/* sky riding the crown of the front fender and the rear haunch */}
          <path
            d="M 862 182 C 840 160 812 148 780 148 C 748 148 724 160 710 178 L 702 194 C 720 172 744 160 780 160 C 816 160 842 176 866 198 Z"
            fill="#fff"
            opacity=".34"
          />
          <path
            d="M 334 152 C 316 142 290 138 262 139 C 230 140 206 148 190 158 L 188 170 C 208 159 232 152 262 151 C 292 150 316 156 334 165 Z"
            fill="#fff"
            opacity=".3"
          />
          <ellipse cx="806" cy="170" rx="52" ry="13" fill={`url(#${p}-spec)`} transform="rotate(-20 806 170)" />
          <ellipse cx="250" cy="150" rx="44" ry="10" fill={`url(#${p}-spec)`} transform="rotate(-6 250 150)" />

          {/* the horizon, reflected hard along the flank */}
          <path
            d="M 150 205 C 330 236 540 240 700 214 C 758 205 806 190 844 172 L 848 181 C 810 201 760 215 702 225 C 540 249 330 247 148 215 Z"
            fill="#f2fff8"
            opacity=".6"
          />
          <path
            d="M 152 213 C 330 243 540 245 700 221 L 700 226 C 540 251 330 251 150 221 Z"
            fill="#04150e"
            opacity=".45"
          />

          {/* nose and tail sit at the bottom of the vertical ramp; light them back up */}
          <ellipse cx="888" cy="216" rx="60" ry="46" fill={`url(#${p}-spec)`} opacity=".34" />
          <ellipse cx="108" cy="218" rx="52" ry="44" fill={`url(#${p}-spec)`} opacity=".26" />
          <ellipse cx="612" cy="212" rx="120" ry="26" fill={`url(#${p}-spec)`} opacity=".16" transform="rotate(-4 612 212)" />

          <circle cx="262" cy="238" r="128" fill={`url(#${p}-archAO)`} />
          <circle cx="760" cy="238" r="128" fill={`url(#${p}-archAO)`} />

          {/* panel creases: a lit edge sitting on a shadowed one */}
          <path d="M 652 194 C 610 208 578 220 556 232" fill="none" stroke="#c3f7dd" strokeWidth={1.4} opacity=".34" />
          <path d="M 653.5 197 C 611.5 211 579.5 223 557.5 235" fill="none" stroke="#00190f" strokeWidth={2.2} opacity=".55" />
          <path d="M 706 182 C 690 190 676 194 656 195" fill="none" stroke="#00190f" strokeWidth={2} opacity=".4" />

          {/* mid-engine side intake */}
          <path d="M 300 176 C 336 190 366 198 392 202 L 384 226 C 350 220 318 208 288 192 Z" fill="#010302" />
          <path d="M 300 176 C 336 190 366 198 392 202 L 392 205 C 362 201 330 193 298 179 Z" fill="#d8ffed" opacity=".38" />
          <path d="M 308 186 C 340 197 366 203 388 207 L 387 211 C 362 207 332 200 306 190 Z" fill="#3f9e70" opacity=".3" />

          <rect x="0" y="230" width="1000" height="58" fill={`url(#${p}-rockerAO)`} />
          <rect x="0" y="222" width="1000" height="66" fill={`url(#${p}-bounce)`} />
          <rect x="82" y="222" width="58" height="60" fill="#000" opacity=".45" />
        </g>

        {/* splitter + diffuser */}
        <path d="M 826 252 C 862 252 886 248 902 240 L 910 250 C 892 264 860 268 830 267 Z" fill="#050e0a" />
        <path d="M 90 242 L 208 254 L 208 266 L 102 262 Z" fill="#050e0a" />

        {/* headlight: housing, lens, hot core, lime signature */}
        <path d="M 848 178 C 872 189 892 201 906 214 L 896 226 C 880 213 860 201 838 190 Z" fill="#060f0b" />
        <path d="M 852 183 C 873 193 890 204 902 215 L 897 221 C 883 210 866 199 845 190 Z" fill="#cfe9da" />
        <path d="M 856 189 C 873 197 887 206 897 215 L 895 218 C 884 209 869 200 851 193 Z" fill="#fff" />
        <path d="M 858.5 195 C 872 202 884 209 891 215" fill="none" stroke="#ccff00" strokeWidth={2.6} strokeLinecap="round" />
        <ellipse cx="878" cy="203" rx="34" ry="17" fill={`url(#${p}-spec)`} opacity=".5" transform="rotate(32 878 203)" />

        {/* taillight bar */}
        <path d="M 86 196 L 138 201 L 138 218 L 85 213 Z" fill="#150907" />
        <path d="M 89 200 L 134 204 L 134 214 L 88 210 Z" fill="#e8341a" />
        <path d="M 91 202 L 132 206 L 132 209 L 90 205 Z" fill="#ffcfc4" opacity=".9" />

        {/* wing mirror */}
        <path d="M 644 150 C 660 144 674 148 678 158 L 652 162 Z" fill="#042c1d" />
        <path d="M 646 151 C 660 146 671 149 675 156 L 660 158 Z" fill="#9fecc6" opacity=".4" />

        {/* glass: tint, a hint of headrests, and a hard reflection streak */}
        <path
          d="M 654 190 L 564 120 C 550 110 534 106 516 106 L 426 106 C 406 106 392 113 379 127 L 342 154 C 424 178 524 188 654 190 Z"
          fill={`url(#${p}-glass)`}
        />
        <path d="M 430 116 L 466 116 L 400 150 L 374 141 Z" fill="#101d17" opacity=".55" />
        <path d="M 452 128 C 462 122 476 122 484 128 L 486 148 L 450 148 Z" fill="#050a08" opacity=".55" />
        <path d="M 512 134 C 521 129 533 129 540 134 L 542 152 L 510 152 Z" fill="#050a08" opacity=".5" />
        <path d="M 566 124 L 650 188 L 622 187 L 542 128 Z" fill="#fff" opacity=".16" />
        <path d="M 592 140 L 646 184 L 636 184 L 582 143 Z" fill="#fff" opacity=".3" />
        <path
          d="M 654 190 L 564 120 C 550 110 534 106 516 106 L 426 106 C 406 106 392 113 379 127 L 342 154"
          fill="none"
          stroke="#0d3f2b"
          strokeWidth={2.6}
        />

        <Wheel cx={262} offset={0} prefix={p} />
        <Wheel cx={760} offset={23} prefix={p} />
      </g>
    </svg>
  );
}

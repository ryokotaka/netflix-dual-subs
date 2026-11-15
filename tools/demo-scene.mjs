// The stand-in "video frame" for the README screenshots: two coworkers talking late in the
// office, drawn as a flat illustration (1440×810). Hand-made, so no rights issues.
// The right 280px is covered by the transcript panel, the middle by the word popup,
// so the people stand left and right of center.

export function sceneSvg() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // city outside the window: towers with lit windows
  let city = '';
  for (let x = 20; x < 1140; x += 40 + rnd() * 60) {
    const w = 50 + rnd() * 80, h = 120 + rnd() * 260, top = 480 - h;
    city += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#141a2e"/>`;
    for (let y = top + 14; y < 470; y += 18) for (let wx = x + 8; wx < x + w - 8; wx += 13) {
      if (rnd() < 0.28) city += `<rect x="${wx.toFixed(0)}" y="${y.toFixed(0)}" width="6" height="8" fill="${rnd() < 0.8 ? '#f3c674' : '#9fd2ff'}" opacity="${(0.55 + rnd() * 0.4).toFixed(2)}"/>`;
    }
  }

  const skinA = '#eab894', skinAShade = '#d49c78', hairA = '#3a241c', sweater = '#c98a3a', sweaterShade = '#a96f2b';
  const skinB = '#a56c48', skinBShade = '#8a5636', hairB = '#191311', jacket = '#2f3d5c', jacketShade = '#24304a';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 810" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26303f"/><stop offset="1" stop-color="#1a202b"/></linearGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1530"/><stop offset=".65" stop-color="#28305a"/><stop offset="1" stop-color="#5a4466"/></linearGradient>
  <linearGradient id="deskTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4f3d"/><stop offset="1" stop-color="#4a372b"/></linearGradient>
  <linearGradient id="deskFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b211b"/><stop offset="1" stop-color="#120e0c"/></linearGradient>
  <linearGradient id="screenBack" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#aab1bc"/><stop offset="1" stop-color="#d3d8df"/></linearGradient>
  <radialGradient id="warm" cx=".22" cy=".42" r=".55"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".28"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx=".42" cy=".42" r=".8"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
  <clipPath id="win"><rect x="40" y="40" width="1100" height="440" rx="4"/></clipPath>
  <filter id="dof" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>

<!-- room -->
<rect width="1440" height="810" fill="url(#wall)"/>
<g clip-path="url(#win)" filter="url(#dof)">
  <rect x="40" y="40" width="1100" height="440" fill="url(#sky)"/>
  ${city}
</g>
<rect x="40" y="40" width="1100" height="440" fill="none" stroke="#323b4d" stroke-width="14"/>
<rect x="400" y="40" width="12" height="440" fill="#323b4d"/><rect x="770" y="40" width="12" height="440" fill="#323b4d"/>
<rect width="1440" height="810" fill="url(#warm)"/>

<!-- B: standing behind the desk, facing left, mug in hand -->
<path d="M905 560 C905 430 915 352 962 332 L1044 332 C1090 352 1100 430 1100 560 Z" fill="${jacket}"/>
<path d="M975 332 L1003 420 L1031 332 Z" fill="#e9e3d7"/>
<path d="M1003 420 L990 372 L1003 380 L1016 372 Z" fill="#c9c2b5"/>
<rect x="985" y="288" width="36" height="52" rx="10" fill="${skinBShade}"/>
<ellipse cx="1000" cy="250" rx="43" ry="50" fill="${skinB}"/>
<ellipse cx="1037" cy="257" rx="7" ry="10" fill="${skinBShade}"/>
<path d="M958 240 C955 206 984 194 1008 195 C1040 197 1052 222 1045 262 C1041 248 1037 240 1029 236 C1004 228 984 230 958 240 Z" fill="${hairB}"/>
<path d="M960 246 q-10 9 -2 17" fill="${skinB}"/>
<ellipse cx="978" cy="252" rx="3.6" ry="4.6" fill="#1f1512"/>
<path d="M970 238 q8 -5 16 -1" stroke="${hairB}" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M966 278 q8 6 16 1" stroke="#5a3322" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M1082 352 Q1108 450 1096 548" stroke="${jacketShade}" stroke-width="38" fill="none" stroke-linecap="round"/>
<path d="M930 352 Q903 405 918 458 L962 424" stroke="${jacket}" stroke-width="36" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="948" y="388" width="36" height="42" rx="6" fill="#d9574f"/>
<path d="M984 398 q14 0 14 12 q0 12 -14 12" stroke="#d9574f" stroke-width="6" fill="none"/>
<circle cx="958" cy="422" r="13" fill="${skinB}"/>

<!-- A: seated at the desk, facing right, laptop open -->
<rect x="135" y="392" width="150" height="190" rx="26" fill="#20242d"/>
<path d="M188 600 C184 520 196 462 240 442 L330 437 C374 447 390 500 393 560 L396 600 Z" fill="${sweater}"/>
<rect x="270" y="396" width="34" height="50" rx="10" fill="${skinAShade}"/>
<ellipse cx="290" cy="362" rx="42" ry="48" fill="${skinA}"/>
<path d="M330 352 q10 12 1 19" fill="${skinA}"/>
<ellipse cx="270" cy="368" rx="7" ry="10" fill="${skinAShade}"/>
<path d="M246 376 C232 318 270 300 300 304 C332 307 344 326 338 342 C312 334 286 338 270 352 C262 372 266 410 252 426 C240 412 242 392 246 376 Z" fill="${hairA}"/>
<ellipse cx="314" cy="361" rx="3.6" ry="4.6" fill="#2a1d18"/>
<path d="M306 347 q8 -4 15 0" stroke="${hairA}" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M314 388 q6 3 12 -1" stroke="#9b5a48" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M346 458 Q380 500 396 536 L460 538" stroke="${sweaterShade}" stroke-width="38" fill="none" stroke-linecap="round" stroke-linejoin="round"/>

<!-- desk and things on it -->
<path d="M0 548 L1440 548 L1440 574 L0 574 Z" fill="url(#deskTop)"/>
<rect x="0" y="574" width="1440" height="236" fill="url(#deskFront)"/>
<path d="M466 549 L610 549 L598 452 L458 455 Z" fill="url(#screenBack)"/>
<rect x="452" y="545" width="168" height="7" rx="3" fill="#8d949f"/>
<circle cx="474" cy="538" r="13" fill="${skinA}"/>
<rect x="176" y="516" width="28" height="33" rx="5" fill="#ece6dc"/>
<path d="M204 524 q11 0 11 9 q0 9 -11 9" stroke="#ece6dc" stroke-width="5" fill="none"/>
<rect x="640" y="534" width="70" height="14" rx="2" fill="#e8e1d3" transform="rotate(-4 675 541)"/>

<rect width="1440" height="810" fill="url(#vig)"/>
</svg>`;
}

import type { ReactNode } from 'react';

/**
 * High-fidelity vector illustration depicting Indian schoolchildren in a positive,
 * forward-looking educational environment. Styled in Asterleaf brand colours:
 * Midnight Navy (#182944), Lagoon Teal (#087F83), Mint (#DDF4EC), Amber (#F6B84B), Orchid (#7654C7).
 */
export function SchoolChildrenIllustration({ className = 'w-full h-auto' }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 680 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Happy schoolchildren collaborating in a modern school campus"
      role="img"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="680" y2="400" gradientUnits="userSpaceOnUse">
          <stop stopColor="#182944" />
          <stop offset="0.6" stopColor="#0B3757" />
          <stop offset="1" stopColor="#087F83" />
        </linearGradient>

        <linearGradient id="campusGlow" x1="340" y1="120" x2="340" y2="380" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DDF4EC" stopOpacity="0.25" />
          <stop offset="1" stopColor="#087F83" stopOpacity="0.05" />
        </linearGradient>

        <linearGradient id="bookGlow" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F6B84B" />
          <stop offset="1" stopColor="#D89225" />
        </linearGradient>

        <linearGradient id="orchidGrad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#9272E5" />
          <stop offset="1" stopColor="#7654C7" />
        </linearGradient>

        <linearGradient id="tealGrad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#14B1B7" />
          <stop offset="1" stopColor="#087F83" />
        </linearGradient>
      </defs>

      {/* Atmospheric Background & Ground Elements */}
      <rect width="680" height="400" rx="24" fill="url(#skyGrad)" />
      <circle cx="340" cy="220" r="190" fill="url(#campusGlow)" />
      
      {/* Distant Architectural Arch & Classroom Elements */}
      <path
        d="M140 380 V210 Q340 130 540 210 V380"
        stroke="#DDF4EC"
        strokeOpacity="0.2"
        strokeWidth="3"
        strokeDasharray="6 6"
        fill="none"
      />
      <circle cx="340" cy="180" r="48" stroke="#F6B84B" strokeOpacity="0.3" strokeWidth="2" fill="none" />
      
      {/* Decorative Science & Learning Floating Motifs */}
      <g opacity="0.85">
        {/* Orbit ring */}
        <ellipse cx="160" cy="110" rx="35" ry="14" stroke="#F6B84B" strokeWidth="2" transform="rotate(-20 160 110)" />
        <circle cx="185" cy="100" r="4" fill="#F6B84B" />
        <circle cx="160" cy="110" r="7" fill="#DDF4EC" />
        
        {/* Math & Code Floating Badges */}
        <rect x="500" y="85" width="48" height="26" rx="8" fill="#7654C7" fillOpacity="0.6" stroke="#DDF4EC" strokeWidth="1" />
        <text x="524" y="102" fill="#FFFFFF" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
          CBSE
        </text>

        <circle cx="510" cy="150" r="18" fill="#087F83" fillOpacity="0.5" stroke="#DDF4EC" strokeWidth="1" />
        <path d="M504 150 L508 154 L516 145" stroke="#DDF4EC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Rising Asterleaf Symbol at Top Center */}
        <path
          d="M340 70 C345 52, 362 50, 360 68 C358 84, 342 90, 340 92 C338 90, 322 84, 320 68 C318 50, 335 52, 340 70 Z"
          fill="#DDF4EC"
        />
      </g>

      {/* Main Ground Platform */}
      <path d="M40 380 Q340 340 640 380" stroke="#087F83" strokeWidth="4" />
      <path d="M40 382 Q340 342 640 382 L640 400 L40 400 Z" fill="#0B2B48" />

      {/* ----------------- Character 1: Girl Student (Left - Class 7) ----------------- */}
      <g id="student-girl">
        {/* Shadow */}
        <ellipse cx="205" cy="375" rx="36" ry="10" fill="#061A2D" opacity="0.6" />

        {/* Legs / Skirt */}
        <rect x="194" y="315" width="9" height="50" rx="4" fill="#182944" />
        <rect x="207" y="315" width="9" height="50" rx="4" fill="#182944" />
        <ellipse cx="198" cy="368" rx="8" ry="4" fill="#182944" />
        <ellipse cx="212" cy="368" rx="8" ry="4" fill="#182944" />

        {/* Uniform Pleated Skirt (Teal check tone) */}
        <path d="M185 270 L225 270 L233 320 L177 320 Z" fill="#087F83" />
        <path d="M195 270 L191 320 M205 270 L205 320 M215 270 L219 320" stroke="#055B5E" strokeWidth="2" />

        {/* School Shirt (Mint White) & School Tie (Amber) */}
        <path d="M188 215 L222 215 L225 272 L185 272 Z" fill="#EBF7F2" />
        {/* Navy Blazer */}
        <path d="M184 215 L198 272 L182 270 Z" fill="#182944" />
        <path d="M226 215 L212 272 L228 270 Z" fill="#182944" />
        {/* School Tie */}
        <path d="M203 218 L207 218 L208 245 L205 250 L202 245 Z" fill="#F6B84B" />

        {/* Arms holding school book */}
        <path d="M184 220 L174 265 L196 268" stroke="#182944" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M226 220 L234 265 L210 268" stroke="#182944" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />

        {/* Book */}
        <rect x="186" y="248" width="38" height="28" rx="4" fill="url(#bookGlow)" />
        <path d="M205 248 L205 276" stroke="#9E610A" strokeWidth="1.5" />
        <line x1="192" y1="256" x2="200" y2="256" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="192" y1="262" x2="200" y2="262" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="210" y1="256" x2="218" y2="256" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="210" y1="262" x2="218" y2="262" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />

        {/* Head, Hair & Smiling Face */}
        <circle cx="205" cy="188" r="19" fill="#E2A77A" />
        {/* Hair - High neat ponytail */}
        <path d="M188 185 C186 165, 224 165, 222 185 C222 195, 219 202, 219 202 C210 205, 198 205, 189 202 Z" fill="#241B18" />
        <path d="M220 180 C234 175, 240 195, 238 215 C233 218, 225 210, 224 195 Z" fill="#241B18" />
        {/* Hairband */}
        <path d="M190 180 Q205 174 220 180" stroke="#087F83" strokeWidth="3" fill="none" />
        {/* Friendly eyes and smile */}
        <circle cx="199" cy="189" r="2" fill="#241B18" />
        <circle cx="211" cy="189" r="2" fill="#241B18" />
        <path d="M202 196 Q205 200 208 196" stroke="#A84328" strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* Cheeks */}
        <circle cx="195" cy="193" r="3" fill="#F49580" opacity="0.4" />
        <circle cx="215" cy="193" r="3" fill="#F49580" opacity="0.4" />
      </g>

      {/* ----------------- Character 2: Senior Student (Center - Class 11 Science) ----------------- */}
      <g id="student-senior">
        {/* Shadow */}
        <ellipse cx="340" cy="378" rx="42" ry="11" fill="#061A2D" opacity="0.6" />

        {/* Trousers (Navy Charcoal) */}
        <rect x="325" y="295" width="13" height="72" rx="4" fill="#182944" />
        <rect x="342" y="295" width="13" height="72" rx="4" fill="#182944" />
        <ellipse cx="331" cy="370" rx="9" ry="5" fill="#0F1B2D" />
        <ellipse cx="349" cy="370" rx="9" ry="5" fill="#0F1B2D" />

        {/* Senior Blazer & White Shirt */}
        <path d="M316 195 L364 195 L368 298 L312 298 Z" fill="#182944" />
        <path d="M328 195 L352 195 L354 260 L326 260 Z" fill="#FFFFFF" />
        {/* School Crest on Pocket */}
        <rect x="321" y="222" width="10" height="12" rx="2" fill="#087F83" />
        <path d="M323 226 L328 231" stroke="#DDF4EC" strokeWidth="1" />
        {/* Senior Tie (Orchid & Gold stripes) */}
        <path d="M338 197 L342 197 L344 240 L340 246 L336 240 Z" fill="#7654C7" />
        <line x1="337" y1="210" x2="343" y2="210" stroke="#F6B84B" strokeWidth="1.5" />
        <line x1="337" y1="222" x2="343" y2="222" stroke="#F6B84B" strokeWidth="1.5" />

        {/* Tablet held in hand displaying graph */}
        <rect x="324" y="246" width="32" height="42" rx="4" fill="#243348" stroke="#DDF4EC" strokeWidth="1.5" />
        <rect x="328" y="250" width="24" height="34" rx="2" fill="#087F83" />
        <path d="M330 274 L336 265 L342 270 L348 258" stroke="#DDF4EC" strokeWidth="2" strokeLinecap="round" />

        {/* Arms */}
        <path d="M316 200 L308 248 L326 260" stroke="#182944" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M364 200 L372 248 L354 260" stroke="#182944" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />

        {/* Head & Confident Expression */}
        <circle cx="340" cy="164" r="22" fill="#DE9F74" />
        {/* Short Styled Hair */}
        <path d="M318 160 C318 138, 362 138, 362 160 C362 166, 358 174, 356 174 C348 171, 332 171, 324 174 Z" fill="#1C1816" />
        {/* Eyes & Smile */}
        <circle cx="333" cy="166" r="2.2" fill="#1C1816" />
        <circle cx="347" cy="166" r="2.2" fill="#1C1816" />
        <path d="M336 174 Q340 178 344 174" stroke="#9E3B21" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>

      {/* ----------------- Character 3: Junior Boy Student (Right - Primary Class 3) ----------------- */}
      <g id="student-junior">
        {/* Shadow */}
        <ellipse cx="475" cy="376" rx="36" ry="10" fill="#061A2D" opacity="0.6" />

        {/* Primary School Shorts (Lagoon Teal) */}
        <rect x="464" y="320" width="9" height="42" rx="4" fill="#DE9F74" />
        <rect x="477" y="320" width="9" height="42" rx="4" fill="#DE9F74" />
        {/* White Socks & Black Shoes */}
        <rect x="463" y="348" width="11" height="15" rx="3" fill="#FFFFFF" />
        <rect x="476" y="348" width="11" height="15" rx="3" fill="#FFFFFF" />
        <ellipse cx="468" cy="368" rx="8" ry="4" fill="#182944" />
        <ellipse cx="482" cy="368" rx="8" ry="4" fill="#182944" />

        {/* Shorts */}
        <path d="M458 280 L492 280 L495 325 L455 325 Z" fill="#087F83" />

        {/* Shirt & Yellow School Backpack Straps */}
        <path d="M460 228 L490 228 L492 282 L458 282 Z" fill="#EBF7F2" />
        {/* School tie */}
        <path d="M473 232 L477 232 L478 255 L475 259 L472 255 Z" fill="#F6B84B" />

        {/* Backpack visible on back */}
        <rect x="488" y="235" width="14" height="40" rx="6" fill="#F6B84B" />
        <path d="M464 230 L466 275 M484 230 L482 275" stroke="#F6B84B" strokeWidth="3" />

        {/* Arm waving cheerily */}
        <path d="M460 232 L444 260 L455 272" stroke="#182944" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M490 232 L514 210 L518 195" stroke="#182944" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* Raised wave hand */}
        <circle cx="519" cy="193" r="6" fill="#E2A77A" />

        {/* Junior Student Head & Broad Smile */}
        <circle cx="475" cy="200" r="18" fill="#E2A77A" />
        {/* Curly hair */}
        <path d="M458 198 C456 180, 494 180, 492 198 C492 205, 489 212, 489 212 C480 214, 468 214, 460 212 Z" fill="#181514" />
        <circle cx="468" cy="182" r="5" fill="#181514" />
        <circle cx="478" cy="181" r="5" fill="#181514" />
        <circle cx="484" cy="184" r="5" fill="#181514" />

        {/* Eyes & Big Kid Grin */}
        <circle cx="470" cy="201" r="2.2" fill="#181514" />
        <circle cx="480" cy="201" r="2.2" fill="#181514" />
        <path d="M470 208 Q475 215 480 208 Z" fill="#A84328" />
        <circle cx="466" cy="205" r="3" fill="#F49580" opacity="0.4" />
        <circle cx="484" cy="205" r="3" fill="#F49580" opacity="0.4" />
      </g>

      {/* Decorative Text Banner Pill at bottom center */}
      <g transform="translate(190, 345)">
        <rect width="300" height="34" rx="17" fill="#182944" stroke="#087F83" strokeWidth="1.5" />
        <circle cx="20" cy="17" r="6" fill="#DDF4EC" />
        <path d="M18 17 L20 19 L23 15" stroke="#087F83" strokeWidth="1.5" strokeLinecap="round" />
        <text x="34" y="21" fill="#FFFFFF" fontSize="11" fontWeight="700" fontFamily="sans-serif">
          NURSERY TO XII · 1,200+ STUDENTS
        </text>
        <rect x="235" y="7" width="55" height="20" rx="10" fill="#F6B84B" />
        <text x="262" y="21" fill="#182944" fontSize="10" fontWeight="800" textAnchor="middle" fontFamily="sans-serif">
          CBSE
        </text>
      </g>
    </svg>
  );
}

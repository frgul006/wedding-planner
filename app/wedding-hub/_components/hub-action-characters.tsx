import motion from "./wedding-hub-motion.module.css";

export function LivingCamera() {
  return (
    <span aria-hidden="true" className={motion.characterStage}>
      <span className={motion.characterShadow} />
      <span className={motion.cameraFloat}>
        <svg viewBox="0 0 180 132" fill="none" focusable="false">
          <path d="m57 45 7-16h38l11 16" fill="#5a5750" stroke="#252622" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="70" y="33" width="25" height="10" rx="3" fill="#d9c9ab" />
          <rect x="123" y="35" width="20" height="11" rx="5" fill="#b34a2c" stroke="#252622" strokeWidth="2" />
          <rect x="17" y="60" width="12" height="21" rx="5" fill="#bba785" stroke="#252622" strokeWidth="2" />
          <rect x="151" y="60" width="12" height="21" rx="5" fill="#bba785" stroke="#252622" strokeWidth="2" />
          <rect x="23" y="43" width="134" height="66" rx="17" fill="#303330" stroke="#252622" strokeWidth="2.5" />
          <path d="M40 43h100c9 0 17 7 17 17v3H23v-3c0-10 7-17 17-17Z" fill="#d9c9ab" stroke="#252622" strokeWidth="2.5" />
          <path d="M37 48h21" stroke="#fff5df" strokeWidth="3" strokeLinecap="round" />
          <rect x="127" y="49" width="19" height="9" rx="3" fill="#5a6860" />
          <path d="M136 52h6" stroke="#e7ddc8" strokeWidth="2" strokeLinecap="round" />
          <circle cx="84" cy="77" r="31" fill="#212623" stroke="#181c19" strokeWidth="2" />
          <circle cx="84" cy="77" r="26" fill="#bba785" stroke="#e4d5b9" strokeWidth="2" />
          <g className={motion.cameraLens}>
            <circle cx="84" cy="77" r="21" fill="#657b71" stroke="#252622" strokeWidth="2" />
            <circle cx="86" cy="79" r="13" fill="#273d37" />
            <ellipse cx="78" cy="69" rx="7" ry="4" transform="rotate(-30 78 69)" fill="#f5efdb" />
            <circle cx="94" cy="86" r="3" fill="#a7c0ae" />
          </g>
          <path d="M123 87q7 7 14-1" stroke="#e5d6b9" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="41" cy="78" r="3" fill="#b34a2c" />
          <path d="M37 99h12" stroke="#6f7369" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  );
}

export function SingingNote() {
  return (
    <span aria-hidden="true" className={motion.characterStage}>
      <span className={motion.characterShadow} />
      <span className={motion.musicFloat}>
        <svg viewBox="0 0 180 132" fill="none" focusable="false">
          <path d="M100 30c7 13 31 12 28 29 13-18-7-25-18-31-5-3-8-7-10-10Z" fill="#cc6745" stroke="#763923" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M94 29a6 6 0 0 1 12 0v62H94Z" fill="#b34a2c" stroke="#763923" strokeWidth="2.5" strokeLinejoin="round" />
          <ellipse cx="82" cy="93" rx="25" ry="19" transform="rotate(-18 82 93)" fill="#b34a2c" stroke="#763923" strokeWidth="2.5" />
          <path d="M99 36v37M67 84q7-6 15-6" stroke="#ecaa7f" strokeWidth="3" strokeLinecap="round" />
          <path d="M68 92q4-5 8-1m9-3q4-5 8-1" stroke="#542d21" strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="82" cy="101" rx="4" ry="5" fill="#542d21" />
          <ellipse cx="64" cy="100" rx="4" ry="2" fill="#df8965" />
          <ellipse cx="97" cy="93" rx="4" ry="2" fill="#df8965" />
        </svg>
      </span>
      <span className={`${motion.floatingNote} ${motion.noteOne}`}>
        <svg viewBox="0 0 24 28" fill="currentColor" focusable="false"><path d="M13 2h3v17c0 4-3 7-7 7-3 0-5-2-5-4 0-4 4-7 9-6Z" /></svg>
      </span>
      <span className={`${motion.floatingNote} ${motion.noteTwo}`}>
        <svg viewBox="0 0 28 28" fill="currentColor" focusable="false"><path d="m10 5 15-3v17c0 3-3 5-6 5-2 0-4-1-4-3 0-3 3-5 7-5V8l-9 2v13c0 3-3 5-6 5-2 0-4-1-4-3 0-3 3-5 7-5Z" /></svg>
      </span>
      <span className={`${motion.floatingNote} ${motion.noteThree}`}>
        <svg viewBox="0 0 24 28" fill="currentColor" focusable="false"><path d="M13 2h3c0 5 7 4 6 11-2-3-4-2-6-4v10c0 4-3 7-7 7-3 0-5-2-5-4 0-4 4-7 9-6Z" /></svg>
      </span>
    </span>
  );
}

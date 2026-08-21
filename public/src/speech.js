// The narrator, out loud — browser speechSynthesis, no assets, no network.
// Two voices in one throat: the First Cat reads lowercase lines; a line that
// is entirely UPPERCASE is the Loom, and drops half an octave to say so.

let voice = null;
let picked = false;

function pickVoice() {
  if (picked || !('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;                       // voices load async; retry next say()
  voice =
    vs.find(v => v.lang.startsWith('en') && /female|natural|aria|libby|sonia/i.test(v.name)) ||
    vs.find(v => v.lang.startsWith('en-GB')) ||
    vs.find(v => v.lang.startsWith('en')) ||
    vs[0];
  picked = true;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { picked = false; pickVoice(); };

// speak a card's lines, one utterance per line so the Loom can interrupt
export function say(lines, muted = false) {
  if (!('speechSynthesis' in window) || muted) return;
  speechSynthesis.cancel();
  pickVoice();
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const u = new SpeechSynthesisUtterance(text);
    const loom = text === text.toUpperCase() && /[A-Z]/.test(text);
    u.voice = voice;
    u.rate = loom ? 0.78 : 0.9;
    u.pitch = loom ? 0.55 : 0.9;
    u.volume = loom ? 1 : 0.9;
    speechSynthesis.speak(u);
  }
}

export function hushSpeech() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

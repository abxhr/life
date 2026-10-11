// Tap-to-talk: records with MediaRecorder (works in iPhone/Android home-screen apps, unlike SpeechRecognition) and transcribes on the server.
import { h } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { toast } from './ui.js';

const MAX_MS = 180000;
export const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);

// Returns a button. onText(transcript) fires after a recording is transcribed. Tap to start, tap again to stop.
export function micButton(onText, cls = 'btn icon') {
  let rec = null, chunks = [], timer = null;
  const btn = h('button', { class: cls, type: 'button', 'aria-label': 'Talk', onclick: () => (rec ? rec.stop() : start()) }, icon('mic'));
  const set = (label, on) => { btn.setAttribute('aria-label', label); btn.classList.toggle('primary', on); btn.classList.toggle('rec', on); };
  async function start() {
    if (!navigator.onLine) return toast('Voice needs a connection');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Allow microphone access for Life in your phone settings'); }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); const type = rec.mimeType || mime || 'audio/webm'; rec = null;
      set('Transcribing…', false); btn.disabled = true;
      try {
        const blob = new Blob(chunks, { type });
        if (blob.size < 1500) toast('Recording was empty — check the mic is allowed, then hold the phone closer');
        else { const j = await store.api('/api/ai/transcribe', { method: 'POST', body: blob, headers: { 'Content-Type': type.split(';')[0] } }); if (j.text) onText(j.text); else toast('No speech heard — speak a bit louder and try again'); }
      } catch (e) { toast(e.message); }
      btn.disabled = false; set('Talk', false);
    };
    rec.start(); set('Stop recording', true); timer = setTimeout(() => rec && rec.stop(), MAX_MS);
  }
  return btn;
}

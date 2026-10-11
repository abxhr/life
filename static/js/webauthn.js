// Face ID / Touch ID through passkeys (WebAuthn). The private key stays in the device's Keychain; the server only ever sees the public key and signatures.
import { store } from './store.js';

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
export const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials);

async function post(path, body) {   // no store.api here: the sign-in screen has no session yet
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
}

export async function registerPasskey(name) {   // signed in: set up Face ID on THIS device
  const o = await store.api('/api/passkey/register/options', { method: 'POST', body: '{}' });
  const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: unb64u(c.id) })) } });
  return store.api('/api/passkey/register/verify', { method: 'POST', body: JSON.stringify({ id: b64u(cred.rawId), name, response: { clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject) } }) });
}

export async function unlockWithPasskey() {   // the lock screen: Face ID, then the server checks the signature
  const o = await post('/api/passkey/login/options');
  const a = await navigator.credentials.get({ publicKey: { challenge: unb64u(o.challenge), rpId: o.rpId, allowCredentials: o.allowCredentials.map(c => ({ ...c, id: unb64u(c.id) })), userVerification: 'required', timeout: o.timeout } });
  return post('/api/passkey/login/verify', { id: b64u(a.rawId), response: { clientDataJSON: b64u(a.response.clientDataJSON), authenticatorData: b64u(a.response.authenticatorData), signature: b64u(a.response.signature) } });
}

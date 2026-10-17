// Browser side of the passkey ceremonies (WebAuthn). The biometric check happens
// inside the device's secure hardware; only a signature ever reaches the server.
const toBuf = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
};
const toB64 = (buf) => {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
export const ipHost = () => /^(\d+\.){3}\d+$|^\[.*\]$/.test(location.hostname);

export async function createPasskey(publicKey) {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...publicKey,
      challenge: toBuf(publicKey.challenge),
      user: { ...publicKey.user, id: toBuf(publicKey.user.id) },
      excludeCredentials: (publicKey.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    clientDataJSON: toB64(cred.response.clientDataJSON),
    attestationObject: toB64(cred.response.attestationObject),
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
  };
}

export async function getPasskey(publicKey) {
  const cred = await navigator.credentials.get({
    publicKey: {
      ...publicKey,
      challenge: toBuf(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    clientDataJSON: toB64(cred.response.clientDataJSON),
    authenticatorData: toB64(cred.response.authenticatorData),
    signature: toB64(cred.response.signature),
    userHandle: cred.response.userHandle ? toB64(cred.response.userHandle) : null,
  };
}

export function passkeyError(e) {
  switch (e?.name) {
    case 'NotAllowedError': return 'The passkey request was cancelled, timed out, or blocked by the browser. Please click the button again and approve with Touch ID, Face ID, Windows Hello or your security key.';
    case 'InvalidStateError': return 'This device already holds a passkey for this account.';
    case 'SecurityError': return 'Passkeys need a secure address. Use https:// or http://localhost (not an IP address).';
    case 'NotSupportedError': return 'This device or browser does not support passkeys.';
    case 'AbortError': return 'The passkey request was interrupted. Please try again.';
    default: return e?.message || 'Passkey operation failed.';
  }
}

// A friendly default name for the passkey, so users can tell their devices apart.
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

// Safari (and increasingly other browsers) only show the passkey prompt when it is requested
// directly inside the user's click. Any network round-trip in between loses that "user gesture"
// and the request fails with NotAllowedError. So options are fetched ahead of time and kept fresh;
// the click handler then calls WebAuthn synchronously.
export function prefetcher(fetchOptions, { ttlMs = 4 * 60_000, anchor } = {}) {
  let opts = null, at = 0, pending = null, lastError = null;
  const refresh = () => {
    opts = null;
    pending = fetchOptions().then((o) => { opts = o; at = Date.now(); lastError = null; return o; })
      .catch((e) => { lastError = e; return null; });
    return pending;
  };
  const timer = setInterval(() => {
    if (anchor && !document.body.contains(anchor)) { clearInterval(timer); return; }
    refresh();
  }, ttlMs - 30_000);
  refresh();
  return {
    refresh,
    // Returns ready options (single use) or null if they're still loading or stale.
    take() {
      if (opts && Date.now() - at < ttlMs) { const o = opts; opts = null; return o; }
      if (!pending || (opts && Date.now() - at >= ttlMs)) refresh();
      return null;
    },
    error: () => lastError,
    whenReady: () => pending,
  };
}

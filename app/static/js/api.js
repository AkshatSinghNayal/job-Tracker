// api.js — fetch wrapper with in-memory access token + silent refresh via cookie.
let accessToken = null;

export function getToken() { return accessToken; }
export function setToken(t) { accessToken = t; }
export function clearToken() { accessToken = null; }

async function doRefresh() {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  accessToken = data.access_token;
  return accessToken;
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Login failed');
  }
  const data = await res.json();
  accessToken = data.access_token;
  return data;
}

export async function register(username, password) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Registration failed');
  }
  const data = await res.json();
  accessToken = data.access_token;
  return data;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    accessToken = null;
  }
}

async function request(path, options = {}, retry = true) {
  const headers = { ...(options.headers || {}) };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...options, headers, credentials: 'include' });
  if (res.status === 401 && retry && path !== '/api/auth/login') {
    const refreshed = await doRefresh();
    if (refreshed) return request(path, options, false);
    accessToken = null;
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data.detail;
    const msg = typeof detail === 'string' ? detail
      : Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  del: (path) => request(path, { method: 'DELETE' }),
};

// Multipart upload with real progress via XHR (fetch has no upload progress).
export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const attempt = (isRetry) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.responseType = 'json';
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', async () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
        if (xhr.status === 401 && !isRetry) {
          const refreshed = await doRefresh().catch(() => null);
          if (refreshed) return attempt(true);
        }
        const detail = xhr.response && xhr.response.detail;
        reject(new Error(typeof detail === 'string' ? detail : `Upload failed (${xhr.status})`));
      });
      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.send(formData);
    };
    attempt(false);
  });
}

export function patchUpload(path, formData, onProgress) {
  // PATCH via XHR with progress (same machinery as upload)
  return new Promise((resolve, reject) => {
    const attempt = (isRetry) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PATCH', path);
      xhr.responseType = 'json';
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', async () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
        if (xhr.status === 401 && !isRetry) {
          const refreshed = await doRefresh().catch(() => null);
          if (refreshed) return attempt(true);
        }
        const detail = xhr.response && xhr.response.detail;
        reject(new Error(typeof detail === 'string' ? detail : `Update failed (${xhr.status})`));
      });
      xhr.addEventListener('error', () => reject(new Error('Network error during update')));
      xhr.send(formData);
    };
    attempt(false);
  });
}

// Authenticated binary fetch (for blob URLs, e.g. PDF preview).
export async function fetchBlob(path) {
  const headers = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  let res = await fetch(path, { headers, credentials: 'include' });
  if (res.status === 401) {
    const refreshed = await doRefresh();
    if (refreshed) res = await fetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.blob();
}

export async function downloadFile(path, defaultFilename) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

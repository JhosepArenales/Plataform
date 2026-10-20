// Acceso al backend. Único lugar que conoce URLs y el token de sesión.
const TOKEN_KEY = 'academia.token';

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ } },
  user: null,
};

export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError('Sin conexión con el servidor. Revisa tu internet.', 0);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && session.token) { session.token = null; window.dispatchEvent(new Event('academia:logout')); }
    throw new ApiError(data?.error ?? `Error ${res.status}`, res.status, data);
  }
  return data;
}

// Subida con barra de progreso (fetch no expone progreso de subida).
export function uploadWithProgress(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    if (session.token) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* respuesta no JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error ?? `Error ${xhr.status}`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Se cortó la conexión durante la subida.', 0));
    xhr.send(form);
  });
}

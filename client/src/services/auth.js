// client/src/services/auth.js
const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export async function register({ username, email, password }) {
  const res = await fetch(`${SERVER}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function login({ emailOrUsername, password }) {
  const res = await fetch(`${SERVER}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername, password })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function me() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const res = await fetch(`${SERVER}/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
}

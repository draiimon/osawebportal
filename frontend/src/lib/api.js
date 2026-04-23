import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 15000,
});

export function authHeaders(token) {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

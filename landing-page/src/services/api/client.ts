export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787/api";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload as T;
}

export function withWallet(walletAddress: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
  };
}

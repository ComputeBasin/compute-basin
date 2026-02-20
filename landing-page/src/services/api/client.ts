export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787/api";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  let payload: unknown = null;

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    const rawText = await response.text();
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText || null;
    }
  }

  if (!response.ok) {
    const payloadObj =
      payload && typeof payload === "object" ? (payload as { error?: unknown; message?: unknown }) : null;
    const backendMessage =
      typeof payloadObj?.error === "string"
        ? payloadObj.error
        : typeof payloadObj?.message === "string"
          ? payloadObj.message
          : typeof payload === "string"
            ? payload
            : "";

    const message =
      backendMessage.trim().length > 0
        ? `${backendMessage} (HTTP ${response.status})`
        : `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
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

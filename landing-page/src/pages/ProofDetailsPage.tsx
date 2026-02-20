import { type ChangeEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getProof, verifyProofHash } from "../services/api";
import type { Proof } from "../types/domain";

export function ProofDetailsPage() {
  const { proofId } = useParams();
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashInput, setHashInput] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<{
    localMatch: boolean;
    serverMatch: boolean;
    expectedHash: string;
    providedHash: string;
  } | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  useEffect(() => {
    if (!proofId) {
      return;
    }

    getProof(proofId)
      .then(setProof)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [proofId]);

  function txExplorerUrl(txDigest?: string) {
    if (!txDigest) {
      return "";
    }
    const network =
      (import.meta.env.VITE_IOTA_NETWORK || "testnet").toLowerCase() === "mainnet"
        ? "mainnet"
        : "testnet";
    return `https://explorer.iota.org/transaction/${txDigest}?network=${network}`;
  }

  function normalizeHex(value: string) {
    return value.trim().toLowerCase().replace(/^0x/, "");
  }

  async function handleHashVerification() {
    if (!proof || !proofId) {
      return;
    }
    const normalizedProvided = normalizeHex(hashInput);
    if (!normalizedProvided) {
      setError("Provide a SHA-256 hash to verify");
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(normalizedProvided)) {
      setError("Hash must be a 64-char SHA-256 hex string");
      return;
    }

    try {
      setError(null);
      setVerifyLoading(true);
      const localExpected = normalizeHex(proof.docHashSha256 || "");
      const localMatch = localExpected === normalizedProvided;
      const serverResult = await verifyProofHash({
        proofId,
        docHashSha256: normalizedProvided,
      });
      setVerifyStatus({
        localMatch,
        serverMatch: Boolean(serverResult.match),
        expectedHash: serverResult.expectedHash,
        providedHash: serverResult.providedHash,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hash verification failed");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const digestBuffer = await crypto.subtle.digest("SHA-256", buffer);
      const hash = Array.from(new Uint8Array(digestBuffer))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      setHashInput(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to hash selected file");
    }
  }

  return (
    <section className="space-y-4">
      <Link className="text-sm font-medium text-cyan-300 hover:text-cyan-200" to="/">
        ← Back to home
      </Link>

      <div className="surface p-5">
        <h2 className="text-xl font-semibold text-white">Proof Details</h2>
        <p className="mt-1 text-sm text-slate-300">
          Verifica tecnica notarizzazione: hash, tx digest, issuer, timestamp.
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        {!proof && !error && (
          <p className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm text-cyan-100">
            Loading proof...
          </p>
        )}

        {proof && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-200">
                Chain mode: {proof.chainMode}
              </span>
              <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-200">
                Provider: {proof.notarizationProvider || "passport"}
              </span>
              {proof.iotaSignedBy && (
                <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
                  Signed by: {proof.iotaSignedBy}
                </span>
              )}
              {proof.iotaTxDigest && proof.chainMode === "live" && (
                <a
                  className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100 hover:text-emerald-50"
                  href={txExplorerUrl(proof.iotaTxDigest)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open tx on explorer
                </a>
              )}
            </div>
            {proof.chainMode === "mock" && (
              <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100">
                This proof was created in mock mode. Digests are synthetic and will not appear on IOTA explorer.
              </p>
            )}
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-300">
                Hash verification
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Upload the original file (or paste SHA-256) and compare against notarized hash.
              </p>
              <input
                type="file"
                className="mt-3 block w-full text-xs text-slate-200"
                onChange={handleFileSelected}
              />
              <input
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-cyan-100"
                placeholder="Paste SHA-256 hash"
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value)}
              />
              <button
                className="mt-2 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100"
                onClick={handleHashVerification}
                disabled={verifyLoading || !hashInput.trim()}
              >
                {verifyLoading ? "Verifying..." : "Verify hash"}
              </button>
              {verifyStatus && (
                <p
                  className={`mt-2 text-xs ${
                    verifyStatus.localMatch && verifyStatus.serverMatch
                      ? "text-emerald-200"
                      : "text-rose-200"
                  }`}
                >
                  {verifyStatus.localMatch && verifyStatus.serverMatch ? "MATCH" : "NO MATCH"} • expected{" "}
                  {verifyStatus.expectedHash} • provided {verifyStatus.providedHash}
                </p>
              )}
            </div>
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 font-mono text-xs text-cyan-100">
              {JSON.stringify(proof, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getProof } from "../services/api";
import type { Proof } from "../types/domain";

export function ProofDetailsPage() {
  const { proofId } = useParams();
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proofId) {
      return;
    }

    getProof(proofId)
      .then(setProof)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [proofId]);

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
          <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 font-mono text-xs text-cyan-100">
            {JSON.stringify(proof, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}

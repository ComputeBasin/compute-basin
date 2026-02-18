import { useEffect, useState } from "react";
import { useCurrentAccount } from "@iota/dapp-kit";
import {
  addAcquisitionDoc,
  createPool,
  getMeta,
  getPools,
  getSites,
  upsertComputeOffer,
} from "../services/api";
import type { PoolSummary, Site } from "../types/domain";

function emptyDoc() {
  return {
    name: "",
    docType: "",
    driveUrl: "",
    docHashSha256: "",
  };
}

export function AdminPage() {
  const account = useCurrentAccount();
  const wallet = account?.address?.toLowerCase() || "";

  const [adminWallet, setAdminWallet] = useState<string>("");
  const [sites, setSites] = useState<Site[]>([]);
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [poolForm, setPoolForm] = useState({
    siteId: "",
    title: "",
    description: "",
    location: "",
    landValueTokens: 0,
    surplusTokens: 0,
    fundingDurationDays: 30,
  });
  const [docs, setDocs] = useState([emptyDoc()]);

  const [acquisitionForm, setAcquisitionForm] = useState({
    poolId: "",
    name: "",
    driveUrl: "",
    docHashSha256: "",
  });

  const [computeForm, setComputeForm] = useState({
    poolId: "",
    region: "",
    gpuModel: "",
    gpuCount: 1,
    ramGb: 64,
    storageType: "NVMe",
    storageTb: 4,
    notes: "",
    totalUnits: 100,
    tokensPerUnitHour: 1,
    docsText: "",
  });

  const isAdmin = wallet && adminWallet && wallet === adminWallet;

  async function load() {
    try {
      const [meta, siteData, poolData] = await Promise.all([getMeta(), getSites(), getPools()]);
      setAdminWallet((meta.adminWallet || "").toLowerCase());
      setSites(siteData);
      setPools(poolData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (pools.length === 0) {
      return;
    }

    const firstPoolId = pools[0]?.id || "";
    if (!firstPoolId) {
      return;
    }

    setAcquisitionForm((prev) => {
      if (prev.poolId) {
        return prev;
      }
      return { ...prev, poolId: firstPoolId };
    });

    setComputeForm((prev) => {
      if (prev.poolId) {
        return prev;
      }
      return { ...prev, poolId: firstPoolId };
    });
  }, [pools]);

  async function handleCreatePool() {
    if (!isAdmin) {
      setError("Only the admin wallet can create pools");
      return;
    }

    try {
      setError(null);
      if (!poolForm.siteId || !poolForm.title || !poolForm.location) {
        setError("Site, title and location are required");
        return;
      }
      if (poolForm.fundingDurationDays <= 0) {
        setError("Funding duration must be at least 1 day");
        return;
      }

      await createPool({
        walletAddress: wallet,
        ...poolForm,
        documents: docs
          .filter((doc) => doc.name && doc.docType && doc.driveUrl)
          .map((doc) => ({
            name: doc.name,
            docType: doc.docType,
            driveUrl: doc.driveUrl,
            docHashSha256: doc.docHashSha256 || undefined,
          })),
      });

      setStatus("Pool created and documents notarized");
      setPoolForm({
        siteId: "",
        title: "",
        description: "",
        location: "",
        landValueTokens: 0,
        surplusTokens: 0,
        fundingDurationDays: 30,
      });
      setDocs([emptyDoc()]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pool creation failed");
    }
  }

  async function handleAcquisitionDoc() {
    if (!isAdmin) {
      setError("Only the admin wallet can add an acquisition deed");
      return;
    }

    try {
      setError(null);
      if (!acquisitionForm.poolId) {
        setError("Select a target pool before notarizing acquisition deed");
        return;
      }
      if (!acquisitionForm.name || !acquisitionForm.driveUrl) {
        setError("Acquisition name and drive URL are required");
        return;
      }
      await addAcquisitionDoc({
        walletAddress: wallet,
        ...acquisitionForm,
      });
      setStatus("Acquisition deed notarized");
      setAcquisitionForm({ poolId: "", name: "", driveUrl: "", docHashSha256: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Acquisition document failed");
    }
  }

  async function handleComputeOffer() {
    if (!isAdmin) {
      setError("Only the admin wallet can enable compute offers");
      return;
    }

    try {
      setError(null);
      if (!computeForm.poolId) {
        setError("Select a target pool before enabling compute offer");
        return;
      }
      const parsedDocs = computeForm.docsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, driveUrl] = line.split("|");
          return {
            name: (name || "Document").trim(),
            driveUrl: (driveUrl || "").trim(),
          };
        })
        .filter((item) => item.driveUrl);

      await upsertComputeOffer({
        walletAddress: wallet,
        poolId: computeForm.poolId,
        region: computeForm.region,
        hardware: {
          gpuModel: computeForm.gpuModel,
          gpuCount: Number(computeForm.gpuCount),
          ramGb: Number(computeForm.ramGb),
          storageType: computeForm.storageType,
          storageTb: Number(computeForm.storageTb),
          notes: computeForm.notes,
        },
        totalUnits: Number(computeForm.totalUnits),
        tokensPerUnitHour: Number(computeForm.tokensPerUnitHour),
        documents: parsedDocs,
      });

      setStatus("Compute offer created/updated");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compute offer update failed");
    }
  }

  return (
    <section className="space-y-5">
      <div className="surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Admin dashboard</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Pool and Compute Management</h2>
        <p className="mt-2 text-sm text-slate-300">
          This page is available only to the admin wallet configured in the backend.
        </p>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Connected wallet: {wallet || "not connected"}
          </span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-cyan-100">
            Admin wallet: {adminWallet || "not configured"}
          </span>
        </div>
      </div>

      {!isAdmin && (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">
          Unauthorized wallet. Connect the admin wallet to use this page.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>
      )}
      {status && (
        <p className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{status}</p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <article className="surface p-5">
          <h3 className="text-lg font-semibold text-white">1) Create a New Pool</h3>
          <div className="mt-3 grid gap-3">
            <label className="text-sm text-slate-200">
              Site
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                value={poolForm.siteId}
                onChange={(event) => setPoolForm((prev) => ({ ...prev, siteId: event.target.value }))}
              >
                <option value="">Select site</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.id} - {site.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-200">
              Pool title
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: North Italy Compute Land Pool"
                value={poolForm.title}
                onChange={(e) => setPoolForm((p) => ({ ...p, title: e.target.value }))}
              />
            </label>

            <label className="text-sm text-slate-200">
              Location label
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: North Italy"
                value={poolForm.location}
                onChange={(e) => setPoolForm((p) => ({ ...p, location: e.target.value }))}
              />
            </label>

            <label className="text-sm text-slate-200">
              Description
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Describe the site objective, hardware target and due-diligence scope"
                value={poolForm.description}
                onChange={(e) => setPoolForm((p) => ({ ...p, description: e.target.value }))}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Land value (tokens)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Example: 500000"
                  value={poolForm.landValueTokens || ""}
                  onChange={(e) => setPoolForm((p) => ({ ...p, landValueTokens: Number(e.target.value) }))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Surplus budget (tokens)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Hardware, maintenance, setup"
                  value={poolForm.surplusTokens || ""}
                  onChange={(e) => setPoolForm((p) => ({ ...p, surplusTokens: Number(e.target.value) }))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Funding duration (days)
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={poolForm.fundingDurationDays || ""}
                  onChange={(e) =>
                    setPoolForm((p) => ({ ...p, fundingDurationDays: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>

            <p className="text-xs text-slate-400">
              Pool documents (Google Drive links). You can optionally add a SHA-256 hash.
            </p>
            {docs.map((doc, index) => (
              <div key={`doc-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-slate-900/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Document {index + 1}</p>
                  <button
                    type="button"
                    className="rounded-md border border-rose-300/30 bg-rose-400/10 px-2 py-1 text-xs text-rose-200"
                    onClick={() => setDocs((prev) => prev.filter((_, i) => i !== index))}
                    disabled={docs.length <= 1}
                  >
                    Remove
                  </button>
                </div>

                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Document name"
                  value={doc.name}
                  onChange={(e) =>
                    setDocs((prev) => prev.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)))
                  }
                />
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Document type (e.g. site plan, cost sheet)"
                  value={doc.docType}
                  onChange={(e) =>
                    setDocs((prev) => prev.map((it, i) => (i === index ? { ...it, docType: e.target.value } : it)))
                  }
                />
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Google Drive URL"
                  value={doc.driveUrl}
                  onChange={(e) =>
                    setDocs((prev) => prev.map((it, i) => (i === index ? { ...it, driveUrl: e.target.value } : it)))
                  }
                />
                <input
                  className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="SHA-256 hash (optional)"
                  value={doc.docHashSha256}
                  onChange={(e) =>
                    setDocs((prev) =>
                      prev.map((it, i) => (i === index ? { ...it, docHashSha256: e.target.value } : it))
                    )
                  }
                />
              </div>
            ))}

            <button
              className="rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              onClick={() => setDocs((prev) => [...prev, emptyDoc()])}
            >
              + Add document
            </button>

            <button
              className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={handleCreatePool}
            >
              Create pool and notarize documents
            </button>
          </div>
        </article>

        <article className="surface p-5">
          <h3 className="text-lg font-semibold text-white">2) Acquisition Deed and Compute Offer</h3>

          <div className="mt-3 grid gap-3">
            <label className="text-sm text-slate-200">
              Target pool
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                value={acquisitionForm.poolId}
                onChange={(e) => {
                  const selectedPoolId = e.target.value;
                  setAcquisitionForm((p) => ({ ...p, poolId: selectedPoolId }));
                  setComputeForm((p) => ({ ...p, poolId: selectedPoolId || p.poolId }));
                }}
              >
                <option value="">Select pool</option>
                {pools.map((pool) => (
                  <option key={pool.id} value={pool.id}>{pool.title} ({pool.status})</option>
                ))}
              </select>
            </label>

            <input
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
              placeholder="Acquisition deed document name"
              value={acquisitionForm.name}
              onChange={(e) => setAcquisitionForm((p) => ({ ...p, name: e.target.value }))}
            />
            <input
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
              placeholder="Google Drive URL"
              value={acquisitionForm.driveUrl}
              onChange={(e) => setAcquisitionForm((p) => ({ ...p, driveUrl: e.target.value }))}
            />
            <input
              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
              placeholder="SHA-256 hash (optional)"
              value={acquisitionForm.docHashSha256}
              onChange={(e) => setAcquisitionForm((p) => ({ ...p, docHashSha256: e.target.value }))}
            />

            <button
              className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100"
              onClick={handleAcquisitionDoc}
              disabled={!acquisitionForm.poolId}
            >
              Notarize acquisition deed
            </button>

            <hr className="border-white/10" />

            <label className="text-sm text-slate-200">
              Compute region
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: North Italy"
                value={computeForm.region}
                onChange={(e) =>
                  setComputeForm((p) => ({ ...p, region: e.target.value, poolId: acquisitionForm.poolId || p.poolId }))
                }
              />
            </label>

            <label className="text-sm text-slate-200">
              GPU model
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: NVIDIA H100"
                value={computeForm.gpuModel}
                onChange={(e) =>
                  setComputeForm((p) => ({ ...p, gpuModel: e.target.value, poolId: acquisitionForm.poolId || p.poolId }))
                }
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                GPU count (total cards)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={computeForm.gpuCount}
                  onChange={(e) => setComputeForm((p) => ({ ...p, gpuCount: Number(e.target.value) || 0 }))}
                />
              </label>

              <label className="text-sm text-slate-200">
                RAM (GB)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={computeForm.ramGb}
                  onChange={(e) => setComputeForm((p) => ({ ...p, ramGb: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Storage type
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Example: NVMe"
                  value={computeForm.storageType}
                  onChange={(e) => setComputeForm((p) => ({ ...p, storageType: e.target.value }))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Storage capacity (TB)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={computeForm.storageTb}
                  onChange={(e) => setComputeForm((p) => ({ ...p, storageTb: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Total rentable units
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Maximum units users can rent"
                  value={computeForm.totalUnits}
                  onChange={(e) => setComputeForm((p) => ({ ...p, totalUnits: Number(e.target.value) || 0 }))}
                />
              </label>

              <label className="text-sm text-slate-200">
                Price (tokens per unit-hour)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Example: 3"
                  value={computeForm.tokensPerUnitHour}
                  onChange={(e) =>
                    setComputeForm((p) => ({ ...p, tokensPerUnitHour: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>

            <label className="text-sm text-slate-200">
              Hardware notes
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Rack design, cooling setup, maintenance assumptions"
                value={computeForm.notes}
                onChange={(e) => setComputeForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </label>

            <label className="text-sm text-slate-200">
              Extra compute documents
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="One line per document: NAME|GOOGLE_DRIVE_URL"
                value={computeForm.docsText}
                onChange={(e) => setComputeForm((p) => ({ ...p, docsText: e.target.value }))}
              />
            </label>

            <button
              className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={handleComputeOffer}
              disabled={!computeForm.poolId}
            >
              Enable or update compute offer
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

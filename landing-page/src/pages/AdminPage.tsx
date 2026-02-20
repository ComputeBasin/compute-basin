import { useEffect, useMemo, useState } from "react";
import { useCurrentAccount, useIotaClientContext } from "@iota/dapp-kit";
import {
  addAcquisitionDoc,
  createPool,
  createSite,
  finalizePoolDocuments,
  getMeta,
  getPools,
  getSites,
  setAdminIotaNetwork,
  upsertComputeOffer,
} from "../services/api";
import type { IotaNetwork, Meta, PoolSummary, Site } from "../types/domain";

function emptyDoc() {
  return {
    name: "",
    docType: "",
    driveUrl: "",
    docHashSha256: "",
  };
}

function toWalletNetwork(network: IotaNetwork): "localnet" | "testnet" | "mainnet" {
  if (network === "localnet" || network === "mainnet") {
    return network;
  }
  return "testnet";
}

export function AdminPage() {
  const account = useCurrentAccount();
  const { network: walletNetwork, selectNetwork } = useIotaClientContext();
  const wallet = account?.address?.toLowerCase() || "";

  const [adminWallet, setAdminWallet] = useState<string>("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<IotaNetwork>("testnet");
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  const [siteForm, setSiteForm] = useState({
    id: "",
    name: "",
    siteType: "Land",
    areaM2: 1000,
    targetKw: 100,
    approxLocation: "",
    owner: "",
    status: "seed",
    tagsText: "",
    mintOnIota: true,
    iotaSiteObjectId: "",
  });

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

  const [finalizeDocsForm, setFinalizeDocsForm] = useState({
    poolId: "",
    docsText: "",
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
  const acquisitionEligiblePools = useMemo(
    () =>
      pools.filter((pool) =>
        pool.status === "funded" || pool.status === "acquired" || pool.status === "operational"
      ),
    [pools]
  );
  const computeEligiblePools = useMemo(
    () => pools.filter((pool) => pool.status === "acquired" || pool.status === "operational"),
    [pools]
  );
  const finalizeEligiblePools = useMemo(
    () =>
      pools.filter(
        (pool) =>
          pool.status === "open" ||
          pool.status === "funded" ||
          pool.status === "acquired" ||
          pool.status === "operational"
      ),
    [pools]
  );

  async function load() {
    try {
      const [meta, siteData, poolData] = await Promise.all([getMeta(), getSites(), getPools()]);
      setMeta(meta);
      if (meta.iotaActiveNetwork) {
        setSelectedNetwork(meta.iotaActiveNetwork);
      }
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
    if (acquisitionEligiblePools.length === 0) {
      return;
    }
    const firstPoolId = acquisitionEligiblePools[0]?.id || "";
    if (!firstPoolId) {
      return;
    }

    setAcquisitionForm((prev) => {
      if (prev.poolId) {
        return prev;
      }
      return { ...prev, poolId: firstPoolId };
    });

  }, [acquisitionEligiblePools]);

  useEffect(() => {
    if (finalizeEligiblePools.length === 0) {
      return;
    }
    const firstPoolId = finalizeEligiblePools[0]?.id || "";
    if (!firstPoolId) {
      return;
    }

    setFinalizeDocsForm((prev) => {
      if (prev.poolId) {
        return prev;
      }
      return { ...prev, poolId: firstPoolId };
    });
  }, [finalizeEligiblePools]);

  useEffect(() => {
    if (computeEligiblePools.length === 0) {
      return;
    }
    const firstPoolId = computeEligiblePools[0]?.id || "";
    if (!firstPoolId) {
      return;
    }
    setComputeForm((prev) => {
      if (prev.poolId) {
        return prev;
      }
      return { ...prev, poolId: firstPoolId };
    });
  }, [computeEligiblePools]);

  async function handleCreateSite() {
    if (!isAdmin) {
      setError("Only the admin wallet can register sites");
      return;
    }

    try {
      setError(null);
      if (!siteForm.name || !siteForm.siteType || !siteForm.approxLocation) {
        setError("Site name, type and location are required");
        return;
      }
      if (siteForm.areaM2 <= 0) {
        setError("Site area must be > 0");
        return;
      }
      if (siteForm.targetKw < 0) {
        setError("Site target kW must be >= 0");
        return;
      }

      const tags = siteForm.tagsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const response = await createSite({
        walletAddress: wallet,
        id: siteForm.id || undefined,
        name: siteForm.name,
        siteType: siteForm.siteType,
        areaM2: Number(siteForm.areaM2),
        targetKw: Number(siteForm.targetKw),
        approxLocation: siteForm.approxLocation,
        owner: siteForm.owner || undefined,
        status: siteForm.status || undefined,
        tags,
        mintOnIota: siteForm.mintOnIota,
        iotaSiteObjectId: siteForm.iotaSiteObjectId || undefined,
      });

      setStatus(`Site ${response.site.id} registered`);
      setSiteForm({
        id: "",
        name: "",
        siteType: "Land",
        areaM2: 1000,
        targetKw: 100,
        approxLocation: "",
        owner: "",
        status: "seed",
        tagsText: "",
        mintOnIota: true,
        iotaSiteObjectId: "",
      });
      await load();
      setPoolForm((prev) => ({ ...prev, siteId: response.site.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Site creation failed");
    }
  }

  async function handleSwitchNetwork() {
    if (!isAdmin) {
      setError("Only the admin wallet can switch IOTA network");
      return;
    }

    try {
      setError(null);
      setSwitchingNetwork(true);
      const result = await setAdminIotaNetwork({
        walletAddress: wallet,
        network: selectedNetwork,
      });
      selectNetwork(toWalletNetwork(result.activeNetwork));
      window.dispatchEvent(
        new CustomEvent("iota-network-changed", { detail: result.activeNetwork })
      );
      setStatus(`Active network switched to ${result.activeNetwork}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch active network");
    } finally {
      setSwitchingNetwork(false);
    }
  }

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
      setAcquisitionForm((prev) => ({
        ...prev,
        name: "",
        driveUrl: "",
        docHashSha256: "",
      }));
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

  async function handleFinalizeExtraDocs() {
    if (!isAdmin) {
      setError("Only the admin wallet can finalize additional documents");
      return;
    }
    if (!finalizeDocsForm.poolId) {
      setError("Select a pool for batch document finalization");
      return;
    }

    const parsedDocs = finalizeDocsForm.docsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, docType, driveUrl, docHashSha256] = line.split("|");
        return {
          name: (name || "").trim(),
          docType: (docType || "").trim(),
          driveUrl: (driveUrl || "").trim(),
          docHashSha256: (docHashSha256 || "").trim() || undefined,
        };
      })
      .filter((doc) => doc.name && doc.docType && doc.driveUrl);

    if (parsedDocs.length === 0) {
      setError("Add at least one valid line: NAME|DOC_TYPE|DRIVE_URL|OPTIONAL_SHA256");
      return;
    }

    try {
      setError(null);
      const result = await finalizePoolDocuments({
        walletAddress: wallet,
        poolId: finalizeDocsForm.poolId,
        documents: parsedDocs,
      });
      setStatus(
        `Finalized ${result.proofs.length} document(s) in tx ${result.notarization.txDigest || "n/a"}`
      );
      setFinalizeDocsForm((prev) => ({ ...prev, docsText: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch document finalization failed");
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
          <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">
            Active network: {meta?.iotaActiveNetwork || "testnet"}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Wallet network: {walletNetwork}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            IOTA mode: {meta?.iotaMode || "unknown"}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Notarization provider: {meta?.notarizationProvider || "passport"}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Escrow mode: {meta?.useIotaEscrow ? "enabled" : "disabled"}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Escrow package: {meta?.iotaEscrowPackageId || "not configured"}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
            Notarization signer: {meta?.iotaBackendSigner || "not configured"}
          </span>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
            Runtime network control
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-200">
              Active network
              <select
                className="mt-1 w-44 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                value={selectedNetwork}
                onChange={(event) => setSelectedNetwork(event.target.value as IotaNetwork)}
                disabled={!isAdmin || switchingNetwork}
              >
                {(meta?.iotaAvailableNetworks || ["mock", "localnet", "testnet", "mainnet"]).map(
                  (network) => (
                    <option key={network} value={network}>
                      {network}
                    </option>
                  )
                )}
              </select>
            </label>
            <button
              className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSwitchNetwork}
              disabled={!isAdmin || switchingNetwork}
            >
              {switchingNetwork ? "Switching..." : "Switch network"}
            </button>
          </div>
          {meta?.iotaProfiles && meta.iotaProfiles.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Profile status:{" "}
              {meta.iotaProfiles
                .map(
                  (item) =>
                    `${item.network} [pkg:${item.hasPackageId ? "ok" : "missing"}, escrow:${item.hasEscrowPackageId ? "ok" : "missing"}, signer:${item.hasSignerSecretKey ? "ok" : "missing"}]`
                )
                .join(" • ")}
            </p>
          )}
        </div>
      </div>

      {meta?.notarizationSignerMatchesAdmin === false && (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">
          Live notarization signer does not match admin wallet. On testnet, proofs will fail or be inconsistent until signer/admin are aligned.
        </p>
      )}

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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <article className="surface p-5">
          <h3 className="text-lg font-semibold text-white">1) Register Site</h3>
          <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Site code (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="SITE-004"
                  value={siteForm.id}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, id: e.target.value.toUpperCase() }))}
                />
              </label>
              <label className="text-sm text-slate-200">
                Site name
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="North Grid Campus 2"
                  value={siteForm.name}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Site type
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="Land / Warehouse / Data Center"
                  value={siteForm.siteType}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, siteType: e.target.value }))}
                />
              </label>
              <label className="text-sm text-slate-200">
                Approx location
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="North Italy - Lombardia"
                  value={siteForm.approxLocation}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, approxLocation: e.target.value }))}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Area (m2)
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={siteForm.areaM2}
                  onChange={(e) =>
                    setSiteForm((prev) => ({ ...prev, areaM2: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <label className="text-sm text-slate-200">
                Target power (kW)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={siteForm.targetKw}
                  onChange={(e) =>
                    setSiteForm((prev) => ({ ...prev, targetKw: Number(e.target.value) || 0 }))
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">
                Owner wallet (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="0x..."
                  value={siteForm.owner}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, owner: e.target.value }))}
                />
              </label>
              <label className="text-sm text-slate-200">
                Status
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  placeholder="seed"
                  value={siteForm.status}
                  onChange={(e) => setSiteForm((prev) => ({ ...prev, status: e.target.value }))}
                />
              </label>
            </div>

            <label className="text-sm text-slate-200">
              Tags (comma-separated)
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Cooling-ready, Fiber-near"
                value={siteForm.tagsText}
                onChange={(e) => setSiteForm((prev) => ({ ...prev, tagsText: e.target.value }))}
              />
            </label>

            <label className="text-sm text-slate-200">
              Existing on-chain Site object id (optional)
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="0x..."
                value={siteForm.iotaSiteObjectId}
                onChange={(e) =>
                  setSiteForm((prev) => ({ ...prev, iotaSiteObjectId: e.target.value }))
                }
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={siteForm.mintOnIota}
                onChange={(e) => setSiteForm((prev) => ({ ...prev, mintOnIota: e.target.checked }))}
              />
              Mint SiteNFT on IOTA if object id is not provided
            </label>

            <button
              className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={handleCreateSite}
            >
              Register site
            </button>
          </div>
        </article>

        <article className="surface p-5">
          <h3 className="text-lg font-semibold text-white">2) Create a New Pool</h3>
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
          <h3 className="text-lg font-semibold text-white">3) Acquisition Deed and Compute Offer</h3>

          <div className="mt-3 grid gap-3">
            <label className="text-sm text-slate-200">
              Target pool (funded/acquired)
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                value={acquisitionForm.poolId}
                onChange={(e) => {
                  const selectedPoolId = e.target.value;
                  setAcquisitionForm((p) => ({ ...p, poolId: selectedPoolId }));
                  const selectedPoolCanBeCompute = computeEligiblePools.some(
                    (pool) => pool.id === selectedPoolId
                  );
                  setComputeForm((p) => ({
                    ...p,
                    poolId:
                      selectedPoolCanBeCompute
                        ? selectedPoolId
                        : p.poolId || computeEligiblePools[0]?.id || "",
                  }));
                }}
              >
                <option value="">
                  {acquisitionEligiblePools.length > 0 ? "Select pool" : "No funded pool available yet"}
                </option>
                {acquisitionEligiblePools.map((pool) => (
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
              Finalize extra docs (single batch tx)
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                value={finalizeDocsForm.poolId}
                onChange={(e) =>
                  setFinalizeDocsForm((prev) => ({ ...prev, poolId: e.target.value }))
                }
              >
                <option value="">
                  {finalizeEligiblePools.length > 0 ? "Select pool" : "No eligible pool available"}
                </option>
                {finalizeEligiblePools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.title} ({pool.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-200">
              Extra documents batch
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="One line: NAME|DOC_TYPE|GOOGLE_DRIVE_URL|OPTIONAL_SHA256"
                value={finalizeDocsForm.docsText}
                onChange={(e) =>
                  setFinalizeDocsForm((prev) => ({ ...prev, docsText: e.target.value }))
                }
              />
            </label>
            <button
              className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100"
              onClick={handleFinalizeExtraDocs}
              disabled={!finalizeDocsForm.poolId}
            >
              Finalize document batch
            </button>

            <hr className="border-white/10" />

            <label className="text-sm text-slate-200">
              Compute target pool (acquired/operational)
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                value={computeForm.poolId}
                onChange={(e) => setComputeForm((p) => ({ ...p, poolId: e.target.value }))}
              >
                <option value="">
                  {computeEligiblePools.length > 0
                    ? "Select compute pool"
                    : "No acquired pool available yet"}
                </option>
                {computeEligiblePools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.title} ({pool.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-200">
              Compute region
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: North Italy"
                value={computeForm.region}
                onChange={(e) => setComputeForm((p) => ({ ...p, region: e.target.value }))}
              />
            </label>

            <label className="text-sm text-slate-200">
              GPU model
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                placeholder="Example: NVIDIA H100"
                value={computeForm.gpuModel}
                onChange={(e) => setComputeForm((p) => ({ ...p, gpuModel: e.target.value }))}
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
              disabled={!computeForm.poolId || computeEligiblePools.length === 0}
            >
              Enable or update compute offer
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

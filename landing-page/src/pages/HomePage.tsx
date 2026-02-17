import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentAccount } from "@iota/dapp-kit";
import {
  contributeToPool,
  getComputeOffers,
  getPools,
  getWalletSummary,
  rentCompute,
} from "../services/api";
import type { ComputeOffer, PoolSummary, WalletSummary } from "../types/domain";

type TabKey = "pools" | "compute";

export function HomePage() {
  const account = useCurrentAccount();
  const wallet = account?.address?.toLowerCase() || "";

  const [activeTab, setActiveTab] = useState<TabKey>("pools");
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [offers, setOffers] = useState<ComputeOffer[]>([]);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contributionInputs, setContributionInputs] = useState<Record<string, number>>({});
  const [renting, setRenting] = useState<{ offerId: string; units: number; hours: number }>({
    offerId: "",
    units: 1,
    hours: 24,
  });

  const locations = useMemo(() => {
    return Array.from(new Set(offers.map((offer) => offer.region))).sort();
  }, [offers]);
  const [selectedLocation, setSelectedLocation] = useState<string>("");

  const visibleOffers = useMemo(() => {
    if (!selectedLocation) {
      return offers;
    }
    return offers.filter((offer) => offer.region === selectedLocation);
  }, [offers, selectedLocation]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [poolData, offerData] = await Promise.all([getPools(), getComputeOffers()]);
      setPools(poolData);
      setOffers(offerData);
      if (wallet) {
        const summary = await getWalletSummary(wallet);
        setWalletSummary(summary);
      } else {
        setWalletSummary(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [wallet]);

  async function handleContribute(poolId: string) {
    if (!wallet) {
      setError("Connect wallet to contribute");
      return;
    }

    const amount = Number(contributionInputs[poolId] || 0);
    if (amount <= 0) {
      setError("Token amount must be > 0");
      return;
    }

    try {
      setError(null);
      await contributeToPool({
        walletAddress: wallet,
        poolId,
        tokenAmount: amount,
      });
      setContributionInputs((prev) => ({ ...prev, [poolId]: 0 }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contribution failed");
    }
  }

  async function handleRent() {
    if (!wallet) {
      setError("Connect wallet to rent compute");
      return;
    }
    if (!renting.offerId) {
      setError("Select a compute offer");
      return;
    }

    try {
      setError(null);
      await rentCompute({
        walletAddress: wallet,
        offerId: renting.offerId,
        units: Number(renting.units),
        hours: Number(renting.hours),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rental failed");
    }
  }

  return (
    <section className="space-y-5">
      <div className="surface p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Public marketplace
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white sm:text-4xl">
          Land pools + compute rental
        </h2>
        <p className="mt-3 max-w-4xl text-sm text-slate-300 sm:text-base">
          A single participant wallet flow: buy tokens by joining pools, then spend the same tokens
          to rent compute from active sites.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
            Token balance: {walletSummary?.tokenBalance ?? 0} SFC
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-slate-300">
            Contributions: {walletSummary?.contributions.length ?? 0}
          </span>
          <span className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-slate-300">
            Rentals: {walletSummary?.rentals.length ?? 0}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === "pools"
              ? "bg-cyan-300 text-slate-900"
              : "border border-white/15 bg-slate-900/70 text-slate-200"
          }`}
          onClick={() => setActiveTab("pools")}
        >
          Land pools
        </button>
        <button
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === "compute"
              ? "bg-cyan-300 text-slate-900"
              : "border border-white/15 bg-slate-900/70 text-slate-200"
          }`}
          onClick={() => setActiveTab("compute")}
        >
          Rent compute power
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {loading && (
        <p className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm text-cyan-100">
          Loading marketplace data...
        </p>
      )}

      {activeTab === "pools" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {pools.map((pool) => (
            <article key={pool.id} className="surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-white">{pool.title}</h3>
                <span className="rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                  {pool.status}
                </span>
              </div>

              <p className="mt-1 text-sm text-slate-300">{pool.location} • {pool.site?.name}</p>
              <p className="mt-2 text-sm text-slate-400">{pool.description || "No description"}</p>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                  <p className="text-slate-400">Land</p>
                  <p className="font-semibold text-cyan-100">{pool.landValueTokens}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                  <p className="text-slate-400">Surplus</p>
                  <p className="font-semibold text-cyan-100">{pool.surplusTokens}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                  <p className="text-slate-400">Hard cap</p>
                  <p className="font-semibold text-cyan-100">{pool.hardCapTokens}</p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                  <span>Funding progress</span>
                  <span>{pool.percentage}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                    style={{ width: `${pool.percentage}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Raised {pool.raisedTokens} / {pool.hardCapTokens} tokens
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-cyan-100">
                  {pool.docsCount} docs notarized
                </span>
                {pool.acquisitionProofId && (
                  <Link
                    className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-emerald-100"
                    to={`/proofs/${pool.acquisitionProofId}`}
                  >
                    Acquisition deed proof
                  </Link>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  type="number"
                  min={1}
                  className="w-32 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                  placeholder="Tokens"
                  value={contributionInputs[pool.id] || ""}
                  onChange={(event) =>
                    setContributionInputs((prev) => ({
                      ...prev,
                      [pool.id]: Number(event.target.value),
                    }))
                  }
                />
                <button
                  className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
                  onClick={() => handleContribute(pool.id)}
                  disabled={pool.status !== "open"}
                >
                  Buy pool tokens
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {activeTab === "compute" && (
        <div className="space-y-4">
          <div className="surface p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-sm text-slate-200">
                Location
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={selectedLocation}
                  onChange={(event) => setSelectedLocation(event.target.value)}
                >
                  <option value="">All</option>
                  {locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-200">
                Units
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={renting.units}
                  onChange={(event) =>
                    setRenting((prev) => ({ ...prev, units: Number(event.target.value) || 1 }))
                  }
                />
              </label>

              <label className="text-sm text-slate-200">
                Hours
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
                  value={renting.hours}
                  onChange={(event) =>
                    setRenting((prev) => ({ ...prev, hours: Number(event.target.value) || 1 }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visibleOffers.map((offer) => {
              const estimated =
                Number(renting.units || 0) *
                Number(renting.hours || 0) *
                Number(offer.tokensPerUnitHour || 0);

              return (
                <article key={offer.id} className="surface p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-white">{offer.pool?.title || offer.id}</h3>
                    <span className="rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                      {offer.region}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-slate-300">{offer.site?.name} • {offer.site?.approxLocation}</p>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                      <p className="text-slate-400">GPU</p>
                      <p className="font-semibold text-cyan-100">{offer.hardware.gpuModel} x{offer.hardware.gpuCount}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                      <p className="text-slate-400">RAM</p>
                      <p className="font-semibold text-cyan-100">{offer.hardware.ramGb} GB</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                      <p className="text-slate-400">Storage</p>
                      <p className="font-semibold text-cyan-100">{offer.hardware.storageType} {offer.hardware.storageTb} TB</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
                      <p className="text-slate-400">Capacity</p>
                      <p className="font-semibold text-cyan-100">{offer.availableUnits}/{offer.totalUnits} units</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {offer.docs.slice(0, 4).map((doc, index) => {
                      const record = doc as { id?: string; name?: string; driveUrl?: string };
                      if (record.id) {
                        return (
                          <Link
                            key={`${offer.id}-proof-${record.id}`}
                            to={`/proofs/${record.id}`}
                            className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-cyan-100"
                          >
                            {record.name || `Proof ${index + 1}`}
                          </Link>
                        );
                      }

                      if (record.driveUrl) {
                        return (
                          <a
                            key={`${offer.id}-doc-${index}`}
                            href={record.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-slate-300"
                          >
                            {record.name || `Doc ${index + 1}`}
                          </a>
                        );
                      }

                      return null;
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
                      onClick={() => {
                        setRenting((prev) => ({ ...prev, offerId: offer.id }));
                        handleRent();
                      }}
                      disabled={offer.availableUnits <= 0}
                    >
                      Rent compute
                    </button>
                    <span className="text-xs text-slate-300">
                      Cost estimate: {estimated} SFC
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

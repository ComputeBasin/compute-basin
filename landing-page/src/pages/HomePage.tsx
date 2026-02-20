import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@iota/dapp-kit";
import { Transaction } from "@iota/iota-sdk/transactions";
import {
  contributeToPool,
  getComputeOffers,
  getMeta,
  getPools,
  refundPoolContribution,
  getWalletSummary,
  rentCompute,
} from "../services/api";
import type { ComputeOffer, Meta, PoolSummary, WalletSummary } from "../types/domain";

type TabKey = "pools" | "compute";

export function HomePage() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const wallet = account?.address?.toLowerCase() || "";

  const [activeTab, setActiveTab] = useState<TabKey>("pools");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pools, setPools] = useState<PoolSummary[]>([]);
  const [offers, setOffers] = useState<ComputeOffer[]>([]);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contributionInputs, setContributionInputs] = useState<Record<string, string>>({});
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
  const poolTitleById = useMemo(
    () => new Map(pools.map((pool) => [pool.id, pool.title])),
    [pools]
  );
  const recentContributions = useMemo(() => {
    if (!walletSummary?.contributions) {
      return [];
    }
    return [...walletSummary.contributions]
      .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0))
      .slice(0, 6);
  }, [walletSummary?.contributions]);
  const onChainContributionRequired = Boolean(meta?.onChainContributionRequired);
  const escrowEnabledGlobally = Boolean(meta?.useIotaEscrow);
  const activeNetwork = meta?.iotaActiveNetwork || "testnet";
  const runtimeMockMode = meta?.iotaMode === "mock" || activeNetwork === "mock";
  const networkLabel =
    activeNetwork === "mainnet"
      ? "Mainnet"
      : activeNetwork === "localnet"
        ? "Localnet"
        : activeNetwork === "mock"
          ? "Mock (simulated tx)"
        : "Testnet";

  function isEscrowEnabledForPool(pool: PoolSummary | null | undefined) {
    const packageId = pool?.iotaEscrowPackageId || meta?.iotaEscrowPackageId;
    return Boolean(escrowEnabledGlobally && pool?.iotaEscrowObjectId && packageId);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [metaData, poolData, offerData] = await Promise.all([
        getMeta(),
        getPools(),
        getComputeOffers(),
      ]);
      setMeta(metaData);
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

    const rawAmount = (contributionInputs[poolId] || "").trim();
    if (!/^[0-9]+$/.test(rawAmount)) {
      setError("Token amount must be a positive integer");
      return;
    }

    const parsedAmount = BigInt(rawAmount);
    if (parsedAmount <= 0n) {
      setError("Token amount must be > 0");
      return;
    }
    if (parsedAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
      setError(`Token amount exceeds safe limit (${Number.MAX_SAFE_INTEGER})`);
      return;
    }
    const amount = Number(parsedAmount);
    const targetPool = pools.find((item) => item.id === poolId) || null;
    const escrowEnabledForPool = isEscrowEnabledForPool(targetPool);

    let paymentTxDigest: string | undefined;
    try {
      setError(null);
      if (onChainContributionRequired) {
        const rawPriceNanoIota = meta?.contributionPriceNanoIota || "0";
        if (!/^[0-9]+$/.test(rawPriceNanoIota)) {
          throw new Error("Backend contribution price configuration is invalid");
        }
        const priceNanoIota = BigInt(rawPriceNanoIota);
        if (!escrowEnabledGlobally) {
          throw new Error(
            "On-chain contribution requires escrow mode, but backend metadata says escrow is disabled."
          );
        }
        if (priceNanoIota <= 0n) {
          throw new Error("Backend contribution payment policy is not configured");
        }
        if (!escrowEnabledForPool) {
          throw new Error(
            "This pool is not escrow-enabled. Ask admin to recreate/migrate it before contributing."
          );
        }
        if (!runtimeMockMode) {
          const totalPaymentNanoIota = parsedAmount * priceNanoIota;
          const tx = new Transaction();
          const [paymentCoin] = tx.splitCoins(tx.gas, [totalPaymentNanoIota]);
          const escrowPackageId = targetPool?.iotaEscrowPackageId || meta?.iotaEscrowPackageId || "";
          const escrowObjectId = targetPool?.iotaEscrowObjectId || "";
          if (!escrowPackageId || !escrowObjectId) {
            throw new Error(
              "Escrow mode is enabled but pool escrow object/package is missing. Ask admin to recreate pool with escrow."
            );
          }
          tx.moveCall({
            target: `${escrowPackageId}::pool_escrow::contribute`,
            arguments: [tx.object(escrowObjectId), paymentCoin, tx.object("0x6")],
          });

          const txResult = await signAndExecuteTransaction({
            transaction: tx,
            waitForTransaction: true,
          });
          paymentTxDigest = txResult.digest;
        }
      }

      await contributeToPool({
        walletAddress: wallet,
        poolId,
        tokenAmount: amount,
        paymentTxDigest,
      });
      setContributionInputs((prev) => ({ ...prev, [poolId]: "" }));
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Contribution failed";
      if (paymentTxDigest) {
        setError(
          `IOTA payment was sent (${shortDigest(paymentTxDigest)}), but backend contribution recording failed: ${message}`
        );
      } else {
        setError(message);
      }
    }
  }

  async function handleRent(offerIdOverride?: string) {
    if (!wallet) {
      setError("Connect wallet to rent compute");
      return;
    }
    const selectedOfferId = offerIdOverride || renting.offerId;
    if (!selectedOfferId) {
      setError("Select a compute offer");
      return;
    }

    try {
      setError(null);
      await rentCompute({
        walletAddress: wallet,
        offerId: selectedOfferId,
        units: Number(renting.units),
        hours: Number(renting.hours),
      });
      setRenting((prev) => ({ ...prev, offerId: selectedOfferId }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rental failed");
    }
  }

  async function handleRefund(poolId: string) {
    if (!wallet) {
      setError("Connect wallet to request refund");
      return;
    }

    try {
      setError(null);
      let refundTxDigest: string | undefined;
      const targetPool = pools.find((item) => item.id === poolId) || null;
      if (onChainContributionRequired && !isEscrowEnabledForPool(targetPool)) {
        throw new Error(
          "Pool refund must be executed from escrow, but this pool has no escrow metadata."
        );
      }
      if (onChainContributionRequired && isEscrowEnabledForPool(targetPool)) {
        if (!runtimeMockMode) {
          const escrowPackageId =
            targetPool?.iotaEscrowPackageId || meta?.iotaEscrowPackageId || "";
          const escrowObjectId = targetPool?.iotaEscrowObjectId || "";
          const refundableContribution = (walletSummary?.contributions || [])
            .filter(
              (item) =>
                item.poolId === poolId &&
                !item.refundedAtMs &&
                !item.tokensReleasedAtMs &&
                Boolean(item.escrowReceiptObjectId)
            )
            .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0))[0];
          if (!refundableContribution?.escrowReceiptObjectId) {
            throw new Error(
              "No escrow receipt found for this pool on current wallet. Cannot submit on-chain refund."
            );
          }
          if (!escrowPackageId || !escrowObjectId) {
            throw new Error("Escrow package/object is missing on backend metadata");
          }

          const tx = new Transaction();
          tx.moveCall({
            target: `${escrowPackageId}::pool_escrow::refund`,
            arguments: [
              tx.object(escrowObjectId),
              tx.object(refundableContribution.escrowReceiptObjectId),
              tx.object("0x6"),
            ],
          });
          const txResult = await signAndExecuteTransaction({
            transaction: tx,
            waitForTransaction: true,
          });
          refundTxDigest = txResult.digest;
        }
      }

      await refundPoolContribution({
        walletAddress: wallet,
        poolId,
        refundTxDigest,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed");
    }
  }

  function shortDigest(value?: string | null) {
    if (!value) return "n/a";
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
  }

  function formatDate(value?: number | null) {
    if (!value || !Number.isFinite(value)) return "n/a";
    return new Date(value).toLocaleString();
  }

  function txExplorerUrl(txDigest?: string | null) {
    if (!txDigest) return null;
    if (runtimeMockMode || activeNetwork === "localnet") {
      return null;
    }
    const network = activeNetwork === "mainnet" ? "mainnet" : "testnet";
    return `https://explorer.iota.org/transaction/${txDigest}?network=${network}`;
  }

  function formatNanoIotaToIota(nanoIota: bigint, maxDecimals = 6) {
    const base = 1_000_000_000n;
    const whole = nanoIota / base;
    const remainder = nanoIota % base;
    if (remainder === 0n) {
      return whole.toString();
    }
    const decimals = Math.max(0, Math.min(9, maxDecimals));
    const scaled = (remainder * 10n ** BigInt(decimals)) / base;
    const fraction = scaled.toString().padStart(decimals, "0").replace(/0+$/, "");
    return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  }

  function getContributionPreview(poolId: string) {
    const rawAmount = (contributionInputs[poolId] || "").trim();
    if (!/^[0-9]+$/.test(rawAmount)) {
      return null;
    }
    const tokenAmount = BigInt(rawAmount);
    if (tokenAmount <= 0n) {
      return null;
    }
    const rawPriceNano = meta?.contributionPriceNanoIota || "0";
    if (!/^[0-9]+$/.test(rawPriceNano)) {
      return null;
    }
    const priceNano = BigInt(rawPriceNano);
    if (priceNano <= 0n) {
      return null;
    }
    const totalNano = tokenAmount * priceNano;
    return {
      tokenAmount: tokenAmount.toString(),
      totalNano: totalNano.toString(),
      totalIota: formatNanoIotaToIota(totalNano, 9),
    };
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
        <p className="mt-2 inline-flex rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-xs text-slate-200">
          Network: {networkLabel}
        </p>
        {onChainContributionRequired ? (
          <p className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
            {runtimeMockMode
              ? `Mock mode (${meta?.iotaMode || "unknown"}, ${networkLabel}): contributions simulate pool escrow deposits at `
              : `On-chain mode (${meta?.iotaMode || "unknown"}, ${networkLabel}): each contribution triggers a pool escrow smart-contract deposit at `}
            {meta?.contributionPriceNanoIota || "0"} nanoIOTA per token.
            Tokens stay locked
            until pool is funded; if deadline fails, refund is enabled.
            {meta?.tokensPerIota && meta?.iotaPerToken && (
              <> Exchange rate: 1 IOTA = {meta.tokensPerIota} SFC ({meta.iotaPerToken} IOTA/SFC).</>
            )}
            {meta?.useIotaEscrow && meta?.iotaEscrowPackageId && (
              <> Escrow package: {meta.iotaEscrowPackageId}.</>
            )}
            {meta?.notarizationProvider && (
              <> Notarization provider: {meta.notarizationProvider}.</>
            )}
            {runtimeMockMode && (
              <> Notarization and escrow digests are synthetic in mock mode and not visible on explorer.</>
            )}
          </p>
        ) : (
          <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            Demo mode: pool contributions update platform balances off-chain. Your wallet IOTA
            balance is not debited yet.
          </p>
        )}
        {onChainContributionRequired && !escrowEnabledGlobally && (
          <p className="mt-2 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
            On-chain mode requires escrow metadata (`useIotaEscrow=true`) from backend.
            Contributions are disabled until configuration is fixed for {networkLabel}.
          </p>
        )}

        {meta?.notarizationSignerMatchesAdmin === false && (
          <p className="mt-2 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
            Warning: live notarization signer does not match admin wallet. Fix backend signer configuration.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
            Token balance: {walletSummary?.tokenBalance ?? 0} SFC
          </span>
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-amber-100">
            Locked: {walletSummary?.lockedTokenBalance ?? 0} SFC
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

      {walletSummary && recentContributions.length > 0 && (
        <div className="surface p-5">
          <h3 className="text-base font-semibold text-white">Recent contribution activity</h3>
          <div className="mt-3 grid gap-2">
            {recentContributions.map((item) => {
              const paymentUrl = txExplorerUrl(item.paymentTxDigest);
              const refundUrl = txExplorerUrl(item.refundTxDigest);
              const settlementLabel = item.refundedAtMs
                ? "refunded"
                : item.tokensReleasedAtMs
                  ? "released"
                  : item.tokenSettlementMode === "locked"
                    ? "locked"
                    : "liquid";

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-xs"
                >
                  <p className="text-slate-200">
                    {poolTitleById.get(item.poolId) || item.poolId} • {item.tokenAmount} SFC •{" "}
                    {settlementLabel}
                  </p>
                  <p className="mt-0.5 text-slate-400">{formatDate(item.timestampMs)}</p>
                  {item.paymentTxDigest && (
                    <p className="mt-1 text-slate-300">
                      Payment tx:{" "}
                      {paymentUrl ? (
                        <a
                          href={paymentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-200 hover:text-cyan-100"
                        >
                          {shortDigest(item.paymentTxDigest)}
                        </a>
                      ) : (
                        shortDigest(item.paymentTxDigest)
                      )}
                    </p>
                  )}
                  {item.escrowReceiptObjectId && (
                    <p className="mt-1 text-slate-300">
                      Escrow receipt: {shortDigest(item.escrowReceiptObjectId)}
                    </p>
                  )}
                  {item.refundTxDigest && (
                    <p className="mt-1 text-amber-200">
                      Refund tx:{" "}
                      {refundUrl ? (
                        <a
                          href={refundUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-100 hover:text-amber-50"
                        >
                          {shortDigest(item.refundTxDigest)}
                        </a>
                      ) : (
                        shortDigest(item.refundTxDigest)
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "pools" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {pools.map((pool) => {
            const contributionPreview = getContributionPreview(pool.id);
            return (
              <article key={pool.id} className="surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-white">{pool.title}</h3>
                <span className="rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                  {pool.status}
                </span>
              </div>

              <p className="mt-1 text-sm text-slate-300">{pool.location} • {pool.site?.name}</p>
              <p className="mt-2 text-sm text-slate-400">{pool.description || "No description"}</p>
              <p className="mt-2 text-xs text-slate-400">
                Funding deadline: {formatDate(pool.fundingDeadlineMs)}
              </p>

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

              {pool.proofs && pool.proofs.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {pool.proofs.slice(0, 3).map((proof) => (
                    <Link
                      key={proof.id}
                      to={`/proofs/${proof.id}`}
                      className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-200 hover:border-cyan-300/30"
                    >
                      <p className="font-semibold text-cyan-100">{proof.name}</p>
                      <p className="mt-0.5 text-slate-400">
                        {proof.docType} • tx {shortDigest(proof.iotaTxDigest)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-32 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
                  placeholder="Tokens"
                  value={contributionInputs[pool.id] || ""}
                  onChange={(event) =>
                    setContributionInputs((prev) => ({
                      ...prev,
                      [pool.id]: event.target.value,
                    }))
                  }
                />
                <button
                  className="rounded-lg bg-gradient-to-r from-cyan-300 to-emerald-300 px-4 py-2 text-sm font-semibold text-slate-900"
                  onClick={() => handleContribute(pool.id)}
                  disabled={
                    pool.status !== "open" ||
                    (onChainContributionRequired && !isEscrowEnabledForPool(pool))
                  }
                >
                  {onChainContributionRequired
                    ? runtimeMockMode
                      ? "Contribute (mock escrow)"
                      : "Contribute (on-chain escrow)"
                    : "Contribute (demo ledger)"}
                </button>
                {pool.status === "failed" && (
                  <button
                    className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100"
                    onClick={() => handleRefund(pool.id)}
                    disabled={onChainContributionRequired && !isEscrowEnabledForPool(pool)}
                  >
                    {onChainContributionRequired
                      ? isEscrowEnabledForPool(pool)
                        ? runtimeMockMode
                          ? "Claim refund (mock escrow)"
                          : "Claim refund (on-chain)"
                        : "Refund unavailable (migrate pool)"
                      : "Withdraw / Refund"}
                  </button>
                )}
              </div>
              {onChainContributionRequired && contributionPreview && (
                <p className="mt-2 text-xs text-emerald-200">
                  {runtimeMockMode ? "Escrow equivalent (simulated): " : "Wallet signature amount: "}
                  {contributionPreview.totalIota} IOTA ({contributionPreview.totalNano} nanoIOTA)
                </p>
              )}
              </article>
            );
          })}
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
                        handleRent(offer.id);
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

import { Navigate, Route, Routes, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { ProofDetailsPage } from "./pages/ProofDetailsPage";
import { getMeta } from "./services/api";

function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export default function App() {
  const account = useCurrentAccount();
  const [adminWallet, setAdminWallet] = useState("");
  const wallet = account?.address?.toLowerCase() || "";
  const isAdmin = Boolean(wallet && adminWallet && wallet === adminWallet);

  useEffect(() => {
    let mounted = true;
    getMeta()
      .then((meta) => {
        if (!mounted) return;
        setAdminWallet((meta.adminWallet || "").toLowerCase());
      })
      .catch(() => {
        if (!mounted) return;
        setAdminWallet("");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen pb-8">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex w-[min(1200px,94vw)] items-center justify-between gap-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">
              Decentralized Compute Infrastructure
            </p>
            <h1 className="text-lg font-semibold text-white sm:text-2xl">
              ComputeBasin
            </h1>
            <div className="mt-2 flex gap-2 text-xs sm:text-sm">
              <Link className="rounded-full border border-white/10 px-3 py-1 text-slate-200 hover:text-cyan-200" to="/">
                Home
              </Link>
              {isAdmin && (
                <Link className="rounded-full border border-white/10 px-3 py-1 text-slate-200 hover:text-cyan-200" to="/admin">
                  Admin
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {account?.address && (
              <span className="hidden rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 sm:inline-block">
                {trimAddress(account.address)}
              </span>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto mt-6 w-[min(1200px,94vw)]">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/proofs/:proofId" element={<ProofDetailsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

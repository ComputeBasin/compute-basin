import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createNetworkConfig,
  IotaClientProvider,
  WalletProvider,
} from "@iota/dapp-kit";
import { getFullnodeUrl } from "@iota/iota-sdk/client";
import App from "./App";
import "./index.css";
import "@iota/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl("testnet") },
  mainnet: { url: getFullnodeUrl("mainnet") },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IotaClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletProvider>
      </IotaClientProvider>
    </QueryClientProvider>
  </StrictMode>
);

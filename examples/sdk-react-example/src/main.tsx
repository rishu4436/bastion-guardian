import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatUnits, isAddress } from "viem";
import { BastionClient, type Address } from "@bastion-guardian/sdk";
import {
  BastionProvider,
  ProtectWithBastion,
  useBastionPositions,
  useProtectionStatus,
  useRescueHistory,
} from "@bastion-guardian/sdk/react";

// A third-party lending UI embedding BASTION. Configure with VITE_BASTION_API_URL / VITE_BASTION_APP_URL.
const API = import.meta.env.VITE_BASTION_API_URL ?? "http://127.0.0.1:4000";
const APP = import.meta.env.VITE_BASTION_APP_URL ?? "http://localhost:3000";
const client = new BastionClient({ baseUrl: API });

function hf(wad: string | null | undefined) {
  return wad ? Number(formatUnits(BigInt(wad), 18)).toFixed(3) : "-";
}

function Account({ account }: { account: Address }) {
  const positions = useBastionPositions({ account }, { refreshMs: 15_000 });
  const status = useProtectionStatus({ account }, { refreshMs: 15_000 });
  const rescues = useRescueHistory(
    { policyId: status.data?.policy?.policyId, limit: 5 },
    {
      enabled: !!status.data?.policy,
    },
  );
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <ProtectWithBastion account={account} appUrl={APP} />
      <div>
        <h3>Positions</h3>
        {positions.status === "loading" && <p>Loading positions…</p>}
        {positions.status === "error" && (
          <p role="alert">Could not load positions: {positions.error?.message}</p>
        )}
        {positions.status === "success" && positions.data!.length === 0 && (
          <p>No indexed positions for this account.</p>
        )}
        {positions.status === "stale" && <p role="status">Showing last known data; refresh failed.</p>}
        <ul>
          {positions.data?.map((p) => (
            <li key={p.id}>
              chain {p.chainId} · HF {hf(p.healthFactorWad)} · observed{" "}
              {new Date(p.observedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Protection</h3>
        {status.data && (
          <p>
            {status.data.status} · trigger HF {hf(status.data.triggerHealthFactorWad)} · target HF{" "}
            {hf(status.data.targetHealthFactorWad)}
          </p>
        )}
        {status.data?.provenance && <small>{status.data.provenance}</small>}
      </div>
      <div>
        <h3>Recent rescues</h3>
        {rescues.data?.length === 0 && <p>None.</p>}
        <ul>
          {rescues.data?.map((r) => (
            <li key={r.rescueId}>
              {r.state} · {r.executions.filter((e) => e.success).length} successful execution(s) ·{" "}
              <a href={client.proofPdfUrl(r.rescueId)} style={{ color: "#93c5fd" }}>
                Proof of Protection (PDF)
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function App() {
  const [input, setInput] = useState("");
  const account = isAddress(input) ? (input as Address) : undefined;
  return (
    <BastionProvider client={client}>
      <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
        <h1>Example Lending App</h1>
        <p>Embeds BASTION Guardian through the published SDK. API: {API}</p>
        <input
          aria-label="Borrower address"
          placeholder="0x… borrower address"
          value={input}
          onChange={(e) => setInput(e.target.value.trim())}
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #334155" }}
        />
        {account ? <Account account={account} /> : <ProtectWithBastion appUrl={APP} />}
      </main>
    </BastionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

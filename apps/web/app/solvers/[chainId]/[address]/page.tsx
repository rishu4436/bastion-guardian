"use client";

import { useParams } from "next/navigation";
import { SolverProfileView } from "@/components/solver-profile";
import { Hash, PageHeader, Provenance } from "@/components/ui";
import { CHAIN_NAMES, isLocal } from "@/lib/format";

export default function SolverProfile() {
  const { chainId, address } = useParams<{ chainId: string; address: string }>();
  const cid = Number(chainId);
  return (
    <>
      <PageHeader
        title="Solver profile"
        subtitle={
          <span className="flex items-center gap-2">
            <Hash value={address} n={10} /> · {CHAIN_NAMES[cid] ?? cid}{" "}
            {isLocal(cid) && <Provenance kind="local" />}
          </span>
        }
      />
      <SolverProfileView chainId={cid} address={address} />
    </>
  );
}

import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  policyVersions,
  protectionPolicies,
  rescueExecutions,
  rescueIntents,
  settlementClaims,
  settlementEvents,
  solverFills,
  tokens,
} from "@bastion-guardian/db";
import { CHAINS } from "@bastion-guardian/chain-registry";
import { Bytes32, HttpError, json, needDb, type ApiContext } from "../context.js";

export const PROOF_SCHEMA = "bastion.proof-of-protection/v1";
const PATHS: Record<number, string> = { 1: "flash", 2: "solver" };

/** Deterministic JSON (sorted keys) so the content hash is reproducible by anyone holding the same facts. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export interface ProofDocument {
  schema: typeof PROOF_SCHEMA;
  rescueId: string;
  environment: "LOCAL_SIMULATION" | "TESTNET";
  facts: {
    chainId: number;
    chainName: string;
    policy: Record<string, unknown> | null;
    intent: Record<string, unknown> | null;
    executions: Record<string, unknown>[];
    solverFills: Record<string, unknown>[];
    settlementClaim: Record<string, unknown> | null;
    settlementEvents: Record<string, unknown>[];
    debtToken: { address: string; symbol: string; decimals: number } | null;
  };
  outcome: {
    rescued: boolean;
    path: string | null;
    healthFactorBeforeWad: string | null;
    healthFactorAfterWad: string | null;
    repaid: string | null;
    fee: string | null;
    settlement: string | null;
  };
  verification: { contentHash: string; algorithm: "sha256(canonical-json(facts))"; howTo: string[] };
  disclaimer: string;
  generatedAt: string;
}

export async function buildProof(ctx: ApiContext, rescueId: `0x${string}`): Promise<ProofDocument> {
  const db = needDb(ctx);
  const [intent] = await db.select().from(rescueIntents).where(eq(rescueIntents.rescueId, rescueId));
  const executions = await db
    .select()
    .from(rescueExecutions)
    .where(eq(rescueExecutions.rescueId, rescueId))
    .orderBy(asc(rescueExecutions.blockNumber), asc(rescueExecutions.logIndex));
  if (!intent && !executions.length) throw new HttpError(404, "RESCUE_NOT_FOUND");
  const chainId = intent?.chainId ?? executions[0]!.chainId;
  const policyId = intent?.policyId;
  const [fills, claims, events, policyRows, versionRows] = await Promise.all([
    db.select().from(solverFills).where(eq(solverFills.rescueId, rescueId)),
    db.select().from(settlementClaims).where(eq(settlementClaims.rescueId, rescueId)),
    db
      .select()
      .from(settlementEvents)
      .where(eq(settlementEvents.rescueId, rescueId))
      .orderBy(asc(settlementEvents.blockNumber), asc(settlementEvents.logIndex)),
    policyId
      ? db
          .select()
          .from(protectionPolicies)
          .where(and(eq(protectionPolicies.chainId, chainId), eq(protectionPolicies.policyId, policyId)))
      : Promise.resolve([]),
    policyId && intent
      ? db
          .select()
          .from(policyVersions)
          .where(
            and(
              eq(policyVersions.chainId, chainId),
              eq(policyVersions.policyId, policyId),
              eq(policyVersions.version, intent.policyVersion),
            ),
          )
      : Promise.resolve([]),
  ]);
  const policy = policyRows[0];
  const version = versionRows[0];
  const [debt] = policy
    ? await db
        .select()
        .from(tokens)
        .where(and(eq(tokens.chainId, chainId), eq(tokens.address, policy.debtAsset)))
    : [];
  const strip = <T extends Record<string, unknown>>(r: T) => {
    const o = json(r) as Record<string, unknown>;
    delete o.updatedAt; // mutable bookkeeping, not a fact
    return o;
  };
  const facts: ProofDocument["facts"] = {
    chainId,
    chainName:
      CHAINS[chainId as keyof typeof CHAINS]?.name ??
      (chainId === 31337 ? "Local anvil" : `chain ${chainId}`),
    policy: policy
      ? {
          ...strip(policy),
          version: version ? strip(version) : null,
        }
      : null,
    intent: intent ? strip(intent) : null,
    executions: executions.map(strip),
    solverFills: fills.map(strip),
    settlementClaim: claims[0] ? strip(claims[0]) : null,
    settlementEvents: events.map(strip),
    debtToken: debt ? { address: debt.address, symbol: debt.symbol, decimals: debt.decimals } : null,
  };
  const ok = executions.find((e) => e.success);
  const contentHash = createHash("sha256").update(canonicalJson(facts)).digest("hex");
  const local = chainId === 31337;
  return {
    schema: PROOF_SCHEMA,
    rescueId,
    environment: local ? "LOCAL_SIMULATION" : "TESTNET",
    facts,
    outcome: {
      rescued: !!ok,
      path: ok ? (PATHS[ok.path] ?? String(ok.path)) : null,
      healthFactorBeforeWad: ok?.healthFactorBeforeWad ?? null,
      healthFactorAfterWad: ok?.healthFactorAfterWad ?? null,
      repaid: ok?.repaid ?? null,
      fee: ok?.fee ?? null,
      settlement: claims[0]?.state ?? null,
    },
    verification: {
      contentHash,
      algorithm: "sha256(canonical-json(facts))",
      howTo: [
        "Every execution, fill and settlement fact carries (chainId, txHash, blockHash, logIndex).",
        local
          ? "LOCAL SIMULATION: these transactions exist only on a private anvil chain and cannot be checked on a public explorer."
          : "Fetch each receipt with eth_getTransactionReceipt and compare the emitted event fields.",
        "Recompute sha256 over the canonical JSON (keys sorted, no whitespace) of `facts` and compare with contentHash.",
      ],
    },
    disclaimer:
      "Proof of Protection records what the BASTION contracts emitted. It is not insurance and does not guarantee future rescues." +
      (local ? " LOCAL SIMULATION data: not testnet or mainnet." : ""),
    generatedAt: new Date().toISOString(),
  };
}

const fmtUnits = (v: string | null, d: number) => {
  if (v === null) return "-";
  const n = BigInt(v);
  const s = n.toString().padStart(d + 1, "0");
  const i = s.slice(0, s.length - d);
  const f = s
    .slice(s.length - d)
    .replace(/0+$/, "")
    .slice(0, 6);
  return f ? `${i}.${f}` : i;
};

export async function renderProofPdf(p: ProofDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`BASTION Proof of Protection ${p.rescueId}`);
  doc.setSubject(PROOF_SCHEMA);
  doc.setProducer("BASTION Guardian API");
  doc.setCreationDate(new Date(p.generatedAt));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const line = (
    text: string,
    o: { f?: typeof font; size?: number; color?: [number, number, number] } = {},
  ) => {
    const size = o.size ?? 10;
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    // Courier at 8pt fits ~110 chars; wrap long values.
    const max = o.f === mono ? 105 : 100;
    for (let i = 0; i < Math.max(1, text.length); i += max) {
      page.drawText(text.slice(i, i + max), {
        x: 48,
        y,
        size,
        font: o.f ?? font,
        color: rgb(...(o.color ?? [0.1, 0.12, 0.16])),
      });
      y -= size + 5;
    }
  };
  line("BASTION Guardian — Proof of Protection", { f: bold, size: 18 });
  y -= 4;
  if (p.environment === "LOCAL_SIMULATION")
    line("LOCAL SIMULATION — private anvil chain, not testnet or mainnet data", {
      f: bold,
      size: 11,
      color: [0.75, 0.35, 0],
    });
  line(`Rescue ID: ${p.rescueId}`, { f: mono, size: 8 });
  line(`Chain: ${p.facts.chainName} (${p.facts.chainId})`);
  line(`Generated: ${p.generatedAt}`);
  y -= 6;
  line("Outcome", { f: bold, size: 13 });
  const d = p.facts.debtToken?.decimals ?? 18;
  const sym = p.facts.debtToken?.symbol ?? "";
  line(`Rescued: ${p.outcome.rescued ? "yes" : "no"}   Path: ${p.outcome.path ?? "-"}`);
  line(
    `Health factor: ${fmtUnits(p.outcome.healthFactorBeforeWad, 18)} -> ${fmtUnits(p.outcome.healthFactorAfterWad, 18)}`,
  );
  line(`Repaid: ${fmtUnits(p.outcome.repaid, d)} ${sym}   Fee: ${fmtUnits(p.outcome.fee, d)} ${sym}`);
  line(`Settlement: ${p.outcome.settlement ?? "none"}`);
  y -= 6;
  if (p.facts.policy) {
    line("Policy", { f: bold, size: 13 });
    line(`Policy ID: ${String(p.facts.policy.policyId)}`, { f: mono, size: 8 });
    line(`Owner: ${String(p.facts.policy.owner)}`, { f: mono, size: 8 });
    line(`Account: ${String(p.facts.policy.account)}`, { f: mono, size: 8 });
    y -= 6;
  }
  line("On-chain evidence", { f: bold, size: 13 });
  for (const e of p.facts.executions)
    line(
      `execution ${e.success ? "ok" : "failed"} path=${PATHS[Number(e.path)] ?? e.path} block=${e.blockNumber} tx=${e.txHash}`,
      { f: mono, size: 8 },
    );
  for (const f of p.facts.solverFills)
    line(`solver fill ${f.solver} principal=${f.principal} fee=${f.fee} tx=${f.txHash}`, {
      f: mono,
      size: 8,
    });
  for (const e of p.facts.settlementEvents)
    line(`settlement ${e.kind} chain=${e.chainId} block=${e.blockNumber} tx=${e.txHash}`, {
      f: mono,
      size: 8,
    });
  y -= 6;
  line("Verification", { f: bold, size: 13 });
  line(`${p.verification.algorithm}:`);
  line(p.verification.contentHash, { f: mono, size: 8 });
  for (const h of p.verification.howTo) line(`- ${h}`, { size: 9 });
  y -= 6;
  line(p.disclaimer, { size: 8, color: [0.4, 0.4, 0.45] });
  return doc.save();
}

export const proofRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ rescueId: Bytes32 });
  r.get(
    "/rescues/:rescueId/proof",
    {
      schema: {
        tags: ["rescues"],
        summary: "Proof of Protection (JSON): on-chain facts with a reproducible sha256 content hash",
        params,
      },
    },
    async (req) => buildProof(ctx, req.params.rescueId),
  );
  r.get(
    "/rescues/:rescueId/proof.pdf",
    {
      schema: { tags: ["rescues"], summary: "Proof of Protection as a PDF document", params },
    },
    async (req, reply) => {
      const pdf = await renderProofPdf(await buildProof(ctx, req.params.rescueId));
      return reply
        .header("content-type", "application/pdf")
        .header(
          "content-disposition",
          `inline; filename="bastion-proof-${req.params.rescueId.slice(0, 10)}.pdf"`,
        )
        .send(Buffer.from(pdf));
    },
  );
};

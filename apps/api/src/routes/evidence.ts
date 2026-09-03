import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { claims, evidenceSources, claimEvidence } from "@imperium/database";
import { and, desc, eq } from "drizzle-orm";

import { csrfOk, requireAuth } from "../plugins/auth-helpers.js";

const PMDB = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PMDB_SUM = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const CROSSREF = "https://api.crossref.org/works";

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Источник недоступен: ${res.status}`);
  return res.json();
}

interface PubSummary {
  uid: string;
  title?: string;
  fulljournalname?: string;
  pubdate?: string;
  authors?: Array<{ name: string }>;
  elocationid?: string;
}

const evaluateSchema = z.object({
  statement: z.string().min(3).max(2000),
  domain: z.enum(["general", "health", "science", "product", "finance"]).default("general"),
  maxSources: z.number().int().min(1).max(20).default(5),
});

export const registerEvidenceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/claims", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const conditions = [eq(claims.workspaceId, auth.workspaceId)];
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    if (status) conditions.push(eq(claims.status, status));
    const domain = typeof request.query.domain === "string" ? request.query.domain : undefined;
    if (domain) conditions.push(eq(claims.domain, domain));
    const rows = await app.db.select().from(claims).where(and(...conditions)).orderBy(desc(claims.updatedAt)).limit(100);
    return { claims: rows };
  });

  app.post("/claims", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать утверждения" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const parsed = evaluateSchema.pick({ statement: true, domain: true }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите утверждение и домен", detail: parsed.error.flatten().fieldErrors });
    const [c] = await app.db.insert(claims).values({
      workspaceId: auth.workspaceId,
      statement: parsed.data.statement,
      domain: parsed.data.domain,
      status: "evaluating",
      limitations: [],
      contradictions: [],
      whatCouldChange: [],
      assumptions: [],
      createdBy: auth.userId,
    }).returning();
    app.audit(auth, { action: "claim.created", entity: "claim", entityId: c.id, detail: { statement: c.statement } });
    return reply.code(201).send(c);
  });

  app.get("/claims/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const id = (request.params as { id: string }).id;
    const rows = await app.db.select().from(claims).where(and(eq(claims.id, id), eq(claims.workspaceId, auth.workspaceId))).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Утверждение не найдено" });
    const sources = await app.db.select({ source: evidenceSources, link: claimEvidence })
      .from(claimEvidence).innerJoin(evidenceSources, eq(evidenceSources.id, claimEvidence.sourceId))
      .where(eq(claimEvidence.claimId, id)).orderBy(desc(claimEvidence.evidenceQuality));
    return { claim: rows[0], sources };
  });

  app.post("/claims/:id/evaluate", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const claim = (await app.db.select().from(claims).where(and(eq(claims.id, id), eq(claims.workspaceId, auth.workspaceId))).limit(1))[0];
    if (!claim) return reply.code(404).send({ error: "Утверждение не найдено" });

    const maxSources = Math.min(Number((request.body as { maxSources?: number })?.maxSources ?? 5), 20);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const isHealth = claim.domain === "health" || claim.domain === "science";
      const found: Array<{ title: string; authors: string[]; year: number; url: string; doi: string | null; pmid: string | null; source: "pubmed" | "crossref"; quality: number }> = [];

      const term = claim.statement.slice(0, 200);
      if (isHealth) {
        const es = await fetchJson(`${PMDB}?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=${maxSources}`, controller.signal) as { esearchresult?: { idlist?: string[] } };
        const ids = (es.esearchresult?.idlist ?? []).slice(0, maxSources);
        if (ids.length > 0) {
          const su = await fetchJson(`${PMDB_SUM}?db=pubmed&id=${ids.join(",")}&retmode=json`, controller.signal) as { result?: Record<string, PubSummary> };
          for (const pid of ids) {
            const r = su.result?.[pid];
            if (!r) continue;
            const doi = r.elocationid?.match(/doi:\s*(10\.\S+)/i)?.[1] ?? null;
            found.push({ title: r.title ?? pid, authors: (r.authors ?? []).map((a) => a.name), year: Number(r.pubdate?.slice(0, 4) ?? 0), url: `https://pubmed.ncbi.nlm.nih.gov/${pid}/`, doi, pmid: pid, source: "pubmed", quality: 0.9 });
          }
        }
      }

      if (found.length < maxSources) {
        const cr = await fetchJson(`${CROSSREF}?query=${encodeURIComponent(term)}&rows=${maxSources - found.length}&select=title,author,issued,DOI,URL`, controller.signal) as { message?: { items?: Array<{ title?: string[]; author?: Array<{ given?: string; family?: string }>; issued?: { "date-parts"?: number[][] }; DOI?: string; URL?: string }> } };
        for (const it of cr.message?.items ?? []) {
          if (found.length >= maxSources) break;
          found.push({ title: it.title?.[0] ?? it.DOI ?? "Без названия", authors: (it.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean), year: it.issued?.["date-parts"]?.[0]?.[0] ?? 0, url: it.URL ?? `https://doi.org/${it.DOI}`, doi: it.DOI ?? null, pmid: null, source: "crossref", quality: 0.6 });
        }
      }

      if (found.length === 0) {
        await app.db.update(claims).set({ status: "inconclusive", verdict: "Источник сейчас недоступен", updatedAt: new Date() }).where(eq(claims.id, id));
        return reply.code(503).send({ claimId: id, status: "inconclusive", verdict: "Источник сейчас недоступен", sources: [] });
      }

      const sorted = found.sort((a, b) => b.quality - a.quality);
      const strongest = sorted[0];
      const contradicting = sorted.filter((s) => s.source !== strongest.source);
      const n = sorted.length;
      const rct = sorted.some((s) => /randomized|trial/i.test(s.title));
      const systematic = sorted.some((s) => /systematic|meta-analysis/i.test(s.title));
      const quality = systematic ? 0.9 : rct ? 0.75 : n >= 3 ? 0.6 : n === 2 ? 0.45 : 0.3;
      const confidence = quality >= 0.75 ? "высокая" : quality >= 0.45 ? "умеренная" : "низкая";
      const verdict = n === 0 ? "Недостаточно данных"
        : contradicting.length === 0 ? "Скорее подтверждается"
        : strongest.quality - (contradicting[0]?.quality ?? 0) < 0.15 ? "Противоречиво"
        : "Скорее подтверждается";

      const inserted = sorted.map((s) => ({
        sourceId: null as string | null,
        external: { source: s.source, title: s.title, authors: s.authors, year: s.year, url: s.url, doi: s.doi, pmid: s.pmid },
        quality: s.quality,
      }));
      const rows = await app.db.insert(evidenceSources).values(
        inserted.map((e) => ({
          workspaceId: auth.workspaceId,
          claimId: id,
          kind: e.external.source,
          title: e.external.title,
          authors: e.external.authors,
          year: e.external.year,
          url: e.external.url,
          doi: e.external.doi,
          pmid: e.external.pmid,
          quality: e.quality,
        })),
      ).returning();

      const links = rows.map((r, i) => ({ claimId: id, sourceId: r.id, evidenceQuality: sorted[i]?.quality ?? 0.5 }));
      await app.db.insert(claimEvidence).values(links);

      await app.db.update(claims).set({
        status: "partially_verified",
        verdict,
        confidence: quality,
        evidenceQuality: quality,
        limitations: [
          ...(systematic ? [] : ["систематический обзор не найден"]),
          ...(rct ? [] : ["рандомизированное исследование не найдено"]),
          ...(n < 3 ? [`найдено мало источников: ${n}`] : []),
          "внешние индексы (PubMed/Crossref) могли быть частично недоступны",
        ],
        contradictions: contradicting.map((c) => `${c.source}: ${c.title} (${c.year})`),
        whatCouldChange: [
          "появление систематического обзора по теме",
          "новое РКИ с противоположным результатом",
          "рост числа независимых источников до 3+",
        ],
        assumptions: ["источники релевантны формулировке утверждения", "качество источников оценено корректно"],
        updatedAt: new Date(),
      }).where(eq(claims.id, id));

      app.audit(auth, { action: "claim.evaluated", entity: "claim", entityId: id, detail: { verdict, confidence, sources: n } });
      return {
        claimId: id,
        status: "partially_verified",
        verdict,
        confidence,
        evidenceQuality: quality,
        strongest: { source: strongest.source, title: strongest.title, year: strongest.year, url: strongest.url },
        contradicting: contradicting.map((c) => ({ source: c.source, title: c.title, year: c.year })),
        sources: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, url: r.url, quality: r.quality })),
        sourcesCount: n,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await app.db.update(claims).set({ status: "inconclusive", verdict: `Источник сейчас недоступен: ${msg.slice(0, 200)}`, updatedAt: new Date() }).where(eq(claims.id, id));
      return reply.code(502).send({ error: `Оценка не удалась: ${msg.slice(0, 200)}`, claimId: id, status: "inconclusive" });
    } finally {
      clearTimeout(timeout);
    }
  });
};

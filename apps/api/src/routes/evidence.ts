import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { claims, evidenceSources, claimEvidence } from "@imperium/database";
import { and, desc, eq } from "drizzle-orm";

import { csrfOk, requireAuth } from "../plugins/auth-helpers.js";
import type { EvidenceTier, EvidenceItem } from "@imperium/domain";
import { TIER_WEIGHTS, evidenceQuality, VERDICT_LABELS_RU } from "@imperium/domain";

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
  app.get<{ Querystring: { status?: string; domain?: string } }>("/claims", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const conditions = [eq(claims.workspaceId, auth.workspaceId)];
    const status = request.query.status;
    if (status) conditions.push(eq(claims.status, status));
    const domain = request.query.domain;
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
    const inserted = await app.db.insert(claims).values({
      workspaceId: auth.workspaceId,
      statement: parsed.data.statement,
      domain: parsed.data.domain,
      status: "evaluating",
      limitations: [],
      contradictions: [],
      whatCouldChange: [],
      assumptions: [],
    }).returning();
    const c = inserted[0];
    if (!c) return reply.code(500).send({ error: "Не удалось создать утверждение" });
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
      .from(claimEvidence).innerJoin(evidenceSources, eq(evidenceSources.id, claimEvidence.evidenceId))
      .where(eq(claimEvidence.claimId, id)).orderBy(desc(claimEvidence.weight));
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
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const isHealth = claim.domain === "health" || claim.domain === "science";
      // Raw retrieved records: metadata only — no quality is assigned at retrieval time.
      // Quality comes exclusively from study design (tier), never from the source adapter.
      const found: Array<{ title: string; authors: string[]; year: number; url: string; doi: string | null; pmid: string | null; source: "pubmed" | "crossref"; pubTypes: string[]; abstract: string | null }> = [];

      const term = claim.statement.slice(0, 200);
      if (isHealth) {
        const es = await fetchJson(`${PMDB}?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=${maxSources}`, controller.signal) as { esearchresult?: { idlist?: string[] } };
        const ids = (es.esearchresult?.idlist ?? []).slice(0, maxSources);
        if (ids.length > 0) {
          const su = await fetchJson(`${PMDB_SUM}?db=pubmed&id=${ids.join(",")}&retmode=json`, controller.signal) as { result?: Record<string, PubSummary & { pubtype?: Array<{ "#text"?: string }> }> };
          for (const pid of ids) {
            const r = su.result?.[pid];
            if (!r) continue;
            const doi = r.elocationid?.match(/doi:\s*(10\.\S+)/i)?.[1] ?? null;
            const pubTypes = (r.pubtype ?? []).map((p) => p["#text"] ?? "").filter(Boolean);
            found.push({ title: r.title ?? pid, authors: (r.authors ?? []).map((a) => a.name), year: Number(r.pubdate?.slice(0, 4) ?? 0), url: `https://pubmed.ncbi.nlm.nih.gov/${pid}/`, doi, pmid: pid, source: "pubmed", pubTypes, abstract: null });
          }
        }
      }

      if (found.length < maxSources) {
        const cr = await fetchJson(`${CROSSREF}?query=${encodeURIComponent(term)}&rows=${maxSources - found.length}&select=title,author,issued,DOI,URL,type`, controller.signal) as { message?: { items?: Array<{ title?: string[]; author?: Array<{ given?: string; family?: string }>; issued?: { "date-parts"?: number[][] }; DOI?: string; URL?: string; type?: string }> } };
        for (const it of cr.message?.items ?? []) {
          if (found.length >= maxSources) break;
          found.push({ title: it.title?.[0] ?? it.DOI ?? "Без названия", authors: (it.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean), year: it.issued?.["date-parts"]?.[0]?.[0] ?? 0, url: it.URL ?? `https://doi.org/${it.DOI}`, doi: it.DOI ?? null, pmid: null, source: "crossref", pubTypes: it.type ? [it.type] : [], abstract: null });
        }
      }

      // Дедупликация: один и тот же источник из разных адаптеров — не независимые доказательства.
      const seen = new Set<string>();
      const deduped = found.filter((f) => {
        const key = f.doi?.toLowerCase() ?? f.pmid ?? `${f.title.toLowerCase().replace(/[^a-zа-я0-9]/g, "")}:${f.year}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Классификация дизайна исследования по типам публикации (не по источнику, не только по заголовку).
      const classify = (pubTypes: string[], title: string): EvidenceTier => {
        const t = pubTypes.join(" ").toLowerCase();
        if (/systematic review/.test(t)) return "systematic_review";
        if (/meta-?analysis/.test(t)) return "meta_analysis";
        if (/randomized controlled trial|randomised controlled/.test(t)) return "rct";
        if (/clinical trial(?!.*(randomized|randomised))/.test(t) && /phase/.test(t)) return "rct";
        if (/cohort study/.test(t)) return "prospective_cohort";
        if (/observational stud|cross-?sectional|case-?control/.test(t)) return "observational";
        if (/case report/.test(t)) return "case_report";
        if (/in vitro|in vivo|mechanis/.test(t)) return "mechanistic";
        if (/practice guideline|guideline/.test(t)) return "expert_opinion";
        if (/editorial|comment|letter|news/.test(t)) return "expert_opinion";
        // Метаданных недостаточно — честный unknown вместо ложной уверенности.
        return "unknown";
      };

      const items: EvidenceItem[] = deduped.map((f) => ({
        tier: classify(f.pubTypes, f.title),
        // Мета-данные (заголовок/тип публикации) сами по себе не говорят о направлении
        // результата — честная позиция "неизвестно" до анализа содержания.
        supports: false,
        inconclusive: true,
        year: f.year || null,
      }));

      const n = items.length;
      const quality = evidenceQuality(items.map((i) => ({ ...i, supports: true })));
      const confidence = n === 0 ? "insufficient_data" : quality >= 0.75 ? "high" : quality >= 0.5 ? "moderate" : quality > 0.15 ? "low" : "insufficient_data";

      const counts: Record<"systematic" | "rct" | "cohort" | "other", number> = { systematic: 0, rct: 0, cohort: 0, other: 0 };
      for (const i of items) {
        if (i.tier === "systematic_review" || i.tier === "meta_analysis") counts.systematic++;
        else if (i.tier === "rct") counts.rct++;
        else if (i.tier === "prospective_cohort" || i.tier === "observational") counts.cohort++;
        else counts.other++;
      }

      // Верификация содержимого требует анализа результатов исследований (абстракты/полные тексты).
      // Только по метаданным корректный вердикт — "недостаточно данных" с прозрачным списком найденного.
      const verdict = n === 0 ? "insufficient_data" : "insufficient_data";
      const limitations: string[] = [
        "найдены метаданные публикаций, но не их результаты: направление эффекта не оценивалось",
        ...(counts.systematic === 0 ? ["систематический обзор/мета-анализ по теме не найден"] : []),
        ...(counts.rct === 0 ? ["рандомизированное исследование не найдено"] : []),
        ...(n < 3 ? [`найдено мало независимых источников: ${n}`] : []),
        "внешние индексы (PubMed/Crossref) могли быть частично недоступны",
      ];
      const whatCouldChange = [
        "анализ абстрактов/полных текстов найденных публикаций",
        ...(counts.systematic === 0 ? ["появление систематического обзора по теме"] : []),
        "новое крупное РКИ с результатами по теме",
      ];

      if (n === 0) {
        await app.db.update(claims).set({ status: "inconclusive", verdict: "Источники не найдены", confidence: 0, evidenceQuality: 0, updatedAt: new Date() }).where(eq(claims.id, id));
        return reply.code(503).send({ claimId: id, status: "inconclusive", verdict: "insufficient_data", sources: [] });
      }

      const rows = await app.db.insert(evidenceSources).values(
        deduped.map((f) => ({
          workspaceId: auth.workspaceId,
          kind: f.source,
          title: f.title,
          authors: f.authors,
          year: f.year || null,
          url: f.url,
          doi: f.doi,
          pmid: f.pmid,
          tier: classify(f.pubTypes, f.title),
          metadata: { pubTypes: f.pubTypes, retrievedFor: claim.statement.slice(0, 200) },
        })),
      ).returning();

      const links = rows.map((r) => ({ claimId: id, evidenceId: r.id, stance: "neutral", weight: TIER_WEIGHTS[r.tier as EvidenceTier] ?? 0.1 }));
      await app.db.insert(claimEvidence).values(links);

      await app.db.update(claims).set({
        status: "inconclusive",
        verdict,
        confidence: quality,
        evidenceQuality: quality,
        limitations,
        contradictions: [],
        whatCouldChange,
        assumptions: ["источники релевантны формулировке утверждения"],
        updatedAt: new Date(),
      }).where(eq(claims.id, id));

      app.audit(auth, { action: "claim.evaluated", entity: "claim", entityId: id, detail: { verdict, confidence, sources: n } });
      return {
        claimId: id,
        status: "inconclusive",
        verdict,
        confidence,
        evidenceQuality: quality,
        strongest: deduped[0] ? { source: deduped[0].source, title: deduped[0].title, year: deduped[0].year, url: deduped[0].url } : null,
        studyDesigns: Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0)),
        sources: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, url: r.url, tier: r.tier })),
        sourcesCount: n,
        limitations,
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

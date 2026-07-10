import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { SUGGESTIVE_SELLING_MODULE } from "../modules/suggestive-selling";

/**
 * Seed for the SuggestiveSelling module — run with:
 *   npx medusa exec ./src/scripts/seed-suggestive-selling.ts
 *
 * Runs AFTER seed-catalog. Idempotent (wipes its own data first). Seeds:
 *   1. Tier-2 category complement mapping (category → complementary categories).
 *   2. Tier-1 manual product rules AUTO-GENERATED for every Racket + Shoe,
 *      picking complements by brand affinity (SUGG-001). With ~300 catalog
 *      products this yields ~100 rules so most product pages show suggestions.
 */

// Tier-2 / CR-01: source category → complementary categories (by name).
const COMPLEMENT_MAP: Record<string, string[]> = {
  Rackets: ["Strings", "Grips", "Bags"],
  Shoes: ["Socks", "Insoles", "Towels"],
  Shuttlecocks: ["Tubes"],
  Apparel: ["Wristbands", "Headbands"],
};

// Which complement categories each source category's Tier-1 rule pulls from.
const TIER1_COMPLEMENTS: Record<string, string[]> = {
  Rackets: ["Strings", "Grips", "Bags"],
  Shoes: ["Socks", "Insoles"],
};

/** Deterministic pick from a pool, preferring same brand; varies by index. */
function pick(pool: any[], brand: string | null, index: number): any | null {
  if (!pool.length) return null;
  const sameBrand = pool.filter((p) => p.brand && p.brand === brand);
  const from = sameBrand.length ? sameBrand : pool;
  return from[index % from.length];
}

export default async function seedSuggestiveSelling({ container }: ExecArgs) {
  const logger = container.resolve("logger");
  const productModule = container.resolve(Modules.PRODUCT);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const ss: any = container.resolve(SUGGESTIVE_SELLING_MODULE);

  const categories = await productModule.listProductCategories(
    {},
    { select: ["id", "name"], take: 1000 },
  );
  const idByName = new Map(categories.map((c: any) => [c.name, c.id]));

  // ── Tier-2 complement mappings (idempotent wipe + insert) ──
  const rows: any[] = [];
  for (const [source, complements] of Object.entries(COMPLEMENT_MAP)) {
    const sourceId = idByName.get(source);
    if (!sourceId) {
      logger.warn(`[seed:suggestive] category "${source}" not found — skip`);
      continue;
    }
    complements.forEach((comp, order) => {
      const compId = idByName.get(comp);
      if (compId)
        rows.push({
          source_category_id: sourceId,
          complement_category_id: compId,
          display_order: order,
          is_active: true,
        });
    });
  }
  if (rows.length) {
    const existing = await ss.listCategoryComplementMappings(
      {},
      { select: ["id"] },
    );
    if (existing.length)
      await ss.deleteCategoryComplementMappings(existing.map((r: any) => r.id));
    await ss.createCategoryComplementMappings(rows);
    logger.info(
      `[seed:suggestive] created ${rows.length} category complement mappings.`,
    );
  }

  // ── Load products with brand + category (for brand-affinity Tier-1) ──
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata", "categories.name"],
    pagination: { take: 5000 },
  });
  const byCategory = new Map<string, any[]>();
  for (const p of products) {
    const brand = (p.metadata as any)?.brand ?? null;
    for (const c of (p.categories ?? []) as any[]) {
      if (!c?.name) continue;
      if (!byCategory.has(c.name)) byCategory.set(c.name, []);
      byCategory.get(c.name)!.push({ id: p.id, handle: p.handle, brand });
    }
  }

  // ── Wipe existing manual product rules (cascades to items) ──
  const existingRules = await ss.listSuggestionRules(
    {},
    { select: ["id", "type", "tier"] },
  );
  const toDelete = existingRules
    .filter((r: any) => r.type === "product" && r.tier === "manual")
    .map((r: any) => r.id);
  if (toDelete.length) await ss.deleteSuggestionRules(toDelete);

  // ── Auto-generate a Tier-1 rule per Racket + Shoe (brand-matched items) ──
  let created = 0;
  let priority = 10;
  for (const [sourceCat, complementCats] of Object.entries(TIER1_COMPLEMENTS)) {
    const sources = byCategory.get(sourceCat) ?? [];
    for (let idx = 0; idx < sources.length; idx++) {
      const src = sources[idx];
      const items = complementCats
        .map((cat, order) => {
          const chosen = pick(
            byCategory.get(cat) ?? [],
            src.brand,
            idx + order,
          );
          if (!chosen) return null;
          return {
            suggested_product_id: chosen.id,
            display_order: order,
            custom_label: order === 0 ? "Best Match" : null,
          };
        })
        .filter(Boolean);
      if (!items.length) continue;

      await ss.createSuggestionRules({
        name: `Complete your setup: ${src.handle}`,
        type: "product",
        tier: "manual",
        source_product_id: src.id,
        priority: priority++,
        is_active: true,
        items,
      });
      created++;
    }
  }
  logger.info(
    `[seed:suggestive] created ${created} Tier-1 manual product rules (auto brand-matched).`,
  );
}

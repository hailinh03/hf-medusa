import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SUGGESTIVE_SELLING_MODULE } from "../../../modules/suggestive-selling";
import { createCategoryComplementWorkflow } from "../../../workflows/category-complement";


/**
 * Admin category-complement mappings are the Tier 2 / CR-01 candidate source.
 * GET lists mappings. POST creates one mapping and rejects duplicate pairs.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  const { source_category_id, is_active, limit = "50", offset = "0" } = req.query as Record<string, string>;
  const filters: Record<string, unknown> = {};
  if (source_category_id) filters.source_category_id = source_category_id;
  if (is_active !== undefined) filters.is_active = is_active === "true";

  const [category_complements, count] =
    await service.listAndCountCategoryComplementMappings(filters, {
      order: { display_order: "ASC" },
      take: Number(limit),
      skip: Number(offset),
    });
  res.json({ category_complements, count, limit: Number(limit), offset: Number(offset) });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as any;
  const { result: category_complement } = await createCategoryComplementWorkflow(req.scope).run({
    input: {
      source_category_id: body.source_category_id,
      complement_category_id: body.complement_category_id,
      display_order: Number(body.display_order ?? 0),
      is_active: body.is_active ?? true,
    },
  });
  res.status(201).json({ category_complement });
};
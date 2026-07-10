import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SUGGESTIVE_SELLING_MODULE } from "../../../modules/suggestive-selling";
import { AdminErrors } from "../../../lib/errors";

/**
 * Admin category-complement map — Tier-2 / CR-01 source (API_CONTRACT §1.2).
 * SRS described the mapping in prose only; managed here as data (no deploy).
 * GET list · POST create (duplicate pair → 409).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  const { source_category_id, is_active } = req.query as Record<string, string>;
  const filters: Record<string, unknown> = {};
  if (source_category_id) filters.source_category_id = source_category_id;
  if (is_active !== undefined) filters.is_active = is_active === "true";

  const [category_complements, count] =
    await service.listAndCountCategoryComplementMappings(filters, {
      order: { display_order: "ASC" },
    });
  res.json({ category_complements, count });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  const body = (req.body ?? {}) as any;
  const {
    source_category_id,
    complement_category_id,
    display_order = 0,
    is_active = true,
  } = body;

  if (!source_category_id || !complement_category_id) {
    return res.status(422).json({
      type: "invalid_data",
      code: "VALIDATION_ERROR",
      message: "source_category_id and complement_category_id are required",
      customer_message: "Dữ liệu không hợp lệ.",
    });
  }

  const dupes = await service.listCategoryComplementMappings(
    { source_category_id, complement_category_id },
    { select: ["id"] },
  );
  if (dupes.length) throw AdminErrors.complementPairDuplicate();

  const category_complement = await service.createCategoryComplementMappings({
    source_category_id,
    complement_category_id,
    display_order,
    is_active,
  });
  res.status(201).json({ category_complement });
};

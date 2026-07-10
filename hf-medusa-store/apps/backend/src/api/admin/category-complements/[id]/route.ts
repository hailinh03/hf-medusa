import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { SUGGESTIVE_SELLING_MODULE } from "../../../../modules/suggestive-selling";

/** DELETE /admin/category-complements/:id (API_CONTRACT §1.2). */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(SUGGESTIVE_SELLING_MODULE);
  await service.deleteCategoryComplementMappings(req.params.id);
  res.json({ id: req.params.id, object: "category_complement", deleted: true });
};

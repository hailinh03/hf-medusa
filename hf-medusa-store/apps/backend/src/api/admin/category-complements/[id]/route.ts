import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { deleteCategoryComplementWorkflow, updateCategoryComplementWorkflow } from "../../../../workflows/category-complement";

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result: category_complement } = await updateCategoryComplementWorkflow(req.scope).run({
    input: { id: req.params.id, ...((req.body ?? {}) as any) },
  });
  res.json({ category_complement });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await deleteCategoryComplementWorkflow(req.scope).run({ input: { id: req.params.id } });
  res.json(result);
};
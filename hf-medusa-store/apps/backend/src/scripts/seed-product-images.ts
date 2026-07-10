import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Seed placeholder product images — run with:
 *   npx medusa exec ./src/scripts/seed-product-images.ts
 *
 * Only fills products that have NO thumbnail (so real hero images are kept).
 * Uses placehold.co (category-coloured, shows the product name) — renders
 * everywhere because the storefront sets images.unoptimized=true. Idempotent.
 */

const CATEGORY_COLOR: Record<string, string> = {
  Rackets: "0ea5e9",
  Shoes: "f59e0b",
  Strings: "22c55e",
  Grips: "8b5cf6",
  Bags: "ef4444",
  Socks: "14b8a6",
  Insoles: "64748b",
  Shuttlecocks: "eab308",
  Tubes: "a855f7",
  Apparel: "ec4899",
  Wristbands: "06b6d4",
  Headbands: "84cc16",
  Towels: "6366f1",
};
const DEFAULT_COLOR = "334155";

function imageUrl(title: string, category: string): string {
  const bg = CATEGORY_COLOR[category] ?? DEFAULT_COLOR;
  const text = encodeURIComponent(`${title}\n(${category})`).replace(
    /%20/g,
    "+",
  );
  return `https://placehold.co/600x600/${bg}/ffffff/png?text=${text}`;
}

export default async function seedProductImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "categories.name"],
    pagination: { take: 5000 },
  });

  const toUpdate = products
    .filter((p: any) => !p.thumbnail) // keep existing (real) images
    .map((p: any) => {
      const category = (p.categories ?? [])[0]?.name ?? "Accessory";
      const url = imageUrl(p.title, category);
      return { id: p.id, thumbnail: url, images: [{ url }] };
    });

  if (!toUpdate.length) {
    logger.info("[seed:images] all products already have a thumbnail — skip");
    return;
  }

  let done = 0;
  for (let i = 0; i < toUpdate.length; i += 50) {
    await updateProductsWorkflow(container).run({
      input: { products: toUpdate.slice(i, i + 50) },
    });
    done += Math.min(50, toUpdate.length - i);
    logger.info(`[seed:images] ${done}/${toUpdate.length}`);
  }
  logger.info(`[seed:images] set images for ${toUpdate.length} products.`);
}

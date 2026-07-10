import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createInventoryLevelsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createShippingProfilesWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Catalog seed — run with: npx medusa exec ./src/scripts/seed-catalog.ts
 *
 * Seeds ~300 badminton products across 13 categories, many brands, with a wide
 * VND price spread so the SuggestiveSelling engine has rich data (Tier-2
 * backfill, CR-01 category gaps, CR-02 threshold band, CR-03 brand affinity).
 * Includes the specific hero handles the demo/Tier-1 seed references.
 *
 * Idempotent: only creates missing categories/products/inventory-levels.
 * Money = integer VND (INT-01). Brand lives in product.metadata.brand (CR-03).
 */

const CATEGORIES = [
  "Rackets",
  "Strings",
  "Grips",
  "Bags",
  "Shoes",
  "Socks",
  "Insoles",
  "Shuttlecocks",
  "Tubes",
  "Apparel",
  "Wristbands",
  "Headbands",
  "Towels",
];

type SeedProduct = {
  handle: string;
  title: string;
  category: string;
  brand: string;
  price: number;
};

// ── Hero products the Tier-1/demo seed references by handle (keep stable) ──
const EXPLICIT: SeedProduct[] = [
  {
    handle: "yonex-astrox-99-pro",
    title: "Yonex Astrox 99 Pro",
    category: "Rackets",
    brand: "Yonex",
    price: 4_500_000,
  },
  {
    handle: "yonex-nanoflare-800",
    title: "Yonex Nanoflare 800",
    category: "Rackets",
    brand: "Yonex",
    price: 3_800_000,
  },
  {
    handle: "lining-axforce-80",
    title: "Li-Ning Axforce 80",
    category: "Rackets",
    brand: "Li-Ning",
    price: 3_200_000,
  },
  {
    handle: "yonex-pc-65z3",
    title: "Yonex Power Cushion 65Z3",
    category: "Shoes",
    brand: "Yonex",
    price: 2_200_000,
  },
  {
    handle: "victor-a970",
    title: "Victor A970",
    category: "Shoes",
    brand: "Victor",
    price: 1_900_000,
  },
  {
    handle: "yonex-bg65",
    title: "Yonex BG65 String",
    category: "Strings",
    brand: "Yonex",
    price: 150_000,
  },
  {
    handle: "yonex-bg80-power",
    title: "Yonex BG80 Power String",
    category: "Strings",
    brand: "Yonex",
    price: 180_000,
  },
  {
    handle: "lining-no1-string",
    title: "Li-Ning No.1 String",
    category: "Strings",
    brand: "Li-Ning",
    price: 130_000,
  },
  {
    handle: "yonex-ac102-towel-grip",
    title: "Yonex AC102 Towel Grip",
    category: "Grips",
    brand: "Yonex",
    price: 120_000,
  },
  {
    handle: "yonex-super-grap-ac104",
    title: "Yonex Super Grap AC104",
    category: "Grips",
    brand: "Yonex",
    price: 45_000,
  },
  {
    handle: "victor-gr262-grip",
    title: "Victor GR262 Grip",
    category: "Grips",
    brand: "Victor",
    price: 40_000,
  },
  {
    handle: "yonex-pro-bag-92026",
    title: "Yonex Pro Racket Bag 92026",
    category: "Bags",
    brand: "Yonex",
    price: 890_000,
  },
  {
    handle: "victor-br9213-bag",
    title: "Victor BR9213 Bag",
    category: "Bags",
    brand: "Victor",
    price: 750_000,
  },
  {
    handle: "yonex-socks-19120",
    title: "Yonex Socks 19120",
    category: "Socks",
    brand: "Yonex",
    price: 90_000,
  },
  {
    handle: "victor-sk155-socks",
    title: "Victor SK155 Socks",
    category: "Socks",
    brand: "Victor",
    price: 80_000,
  },
  {
    handle: "yonex-pc-insole",
    title: "Yonex Power Cushion Insole",
    category: "Insoles",
    brand: "Yonex",
    price: 250_000,
  },
  {
    handle: "yonex-mavis-350",
    title: "Yonex Mavis 350 Shuttlecocks",
    category: "Shuttlecocks",
    brand: "Yonex",
    price: 350_000,
  },
  {
    handle: "yonex-shuttle-tube-bundle",
    title: "Yonex Shuttlecock Tube Bundle (x3)",
    category: "Tubes",
    brand: "Yonex",
    price: 950_000,
  },
];

const BRANDS = [
  "Yonex",
  "Victor",
  "Li-Ning",
  "Kawasaki",
  "Mizuno",
  "Apacs",
  "Kumpoo",
  "Felet",
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Generate products for a category by iterating brands × model tokens (deterministic). */
function gen(
  category: string,
  tokens: string[],
  brands: string[],
  count: number,
  priceBase: number,
  priceStep: number,
): SeedProduct[] {
  const out: SeedProduct[] = [];
  let i = 0;
  for (const tok of tokens) {
    for (const brand of brands) {
      if (out.length >= count) return out;
      const title = `${brand} ${tok}`;
      out.push({
        handle: slug(title),
        title,
        category,
        brand,
        price: priceBase + (i % 10) * priceStep,
      });
      i++;
    }
  }
  return out;
}

const GENERATED: SeedProduct[] = [
  ...gen(
    "Rackets",
    [
      "Astrox 77",
      "Nanoflare 700",
      "Arcsaber 11",
      "Thruster K",
      "Auraspeed 90",
      "Bladex 900",
      "Windstorm 72",
      "Fortius 80",
    ],
    BRANDS,
    64,
    1_200_000,
    400_000,
  ),
  ...gen(
    "Shoes",
    [
      "Aerus Z",
      "Comfort Z",
      "SHB 65X",
      "P9200",
      "Wave Fang",
      "Ranger",
      "Cross Court",
      "Ultra Speed",
    ],
    BRANDS,
    40,
    900_000,
    250_000,
  ),
  ...gen(
    "Strings",
    [
      "BG66 Ultimax",
      "Aerobite",
      "Nanogy 95",
      "VBS 63",
      "No.5 Boost",
      "Ziggler XT",
    ],
    BRANDS,
    28,
    90_000,
    28_000,
  ),
  ...gen(
    "Grips",
    ["Towel Grip", "PU Overgrip", "Dry Grip", "Cushion Wrap"],
    BRANDS,
    28,
    30_000,
    14_000,
  ),
  ...gen(
    "Bags",
    ["6R Tournament Bag", "9R Pro Bag", "12R Team Bag", "Backpack Elite"],
    BRANDS,
    28,
    450_000,
    150_000,
  ),
  ...gen(
    "Socks",
    ["Sport Crew Socks", "Ankle Socks Pro"],
    BRANDS,
    16,
    60_000,
    13_000,
  ),
  ...gen(
    "Insoles",
    ["Power Cushion Insole", "Shock Absorb Insole"],
    BRANDS,
    12,
    180_000,
    30_000,
  ),
  ...gen(
    "Shuttlecocks",
    ["Aerosensa 30", "Mavis 2000", "Guardian Tube", "Master Feather"],
    BRANDS,
    20,
    250_000,
    70_000,
  ),
  ...gen(
    "Tubes",
    ["Shuttle Box x6", "Shuttle Box x12"],
    BRANDS,
    14,
    800_000,
    180_000,
  ),
  ...gen(
    "Apparel",
    ["Team Jersey", "Match Shorts", "Training Tee"],
    BRANDS,
    24,
    250_000,
    65_000,
  ),
  ...gen(
    "Wristbands",
    ["Wristband Wide", "Wristband Slim"],
    BRANDS,
    12,
    60_000,
    10_000,
  ),
  ...gen(
    "Headbands",
    ["Headband Pro", "Headband Sport"],
    BRANDS,
    12,
    60_000,
    9_000,
  ),
  ...gen(
    "Towels",
    ["Sports Towel", "Microfiber Towel"],
    BRANDS,
    10,
    90_000,
    18_000,
  ),
];

const STOCK_LOCATION_NAME = "Kho HCM";
const OPTION_TITLE = "Loại";
const OPTION_VALUE = "Tiêu chuẩn";

export default async function seedCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // dedupe explicit + generated by handle
  const byHandle = new Map<string, SeedProduct>();
  for (const p of [...EXPLICIT, ...GENERATED])
    if (!byHandle.has(p.handle)) byHandle.set(p.handle, p);
  const ALL = [...byHandle.values()];
  logger.info(
    `[seed:catalog] target ${ALL.length} products across ${CATEGORIES.length} categories`,
  );

  // ── 1. Sales channel ──
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  let [defaultSalesChannel] = await salesChannelModule.listSalesChannels({
    name: "Default Sales Channel",
  });
  if (!defaultSalesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    });
    defaultSalesChannel = result[0];
  }

  // ── 2. Store supports VND ──
  const storeModule = container.resolve(Modules.STORE);
  const [store] = await storeModule.listStores();
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [{ currency_code: "vnd", is_default: true }],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      },
    });
  }

  // ── 3. Stock location + link ──
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);
  let [stockLocation] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION_NAME,
  });
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: { city: "Ho Chi Minh", country_code: "vn", address_1: "" },
          },
        ],
      },
    });
    stockLocation = result[0];
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [defaultSalesChannel.id] },
    });
  }

  // ── 4. Shipping profile ──
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  let [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  });
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    });
    shippingProfile = result[0];
  }

  // ── 5. Categories ──
  const { data: existingCats } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  });
  const catByName = new Map<string, string>(
    existingCats.map((c: any) => [c.name, c.id]),
  );
  const missingCats = CATEGORIES.filter((n) => !catByName.has(n));
  if (missingCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCats.map((name) => ({
          name,
          is_active: true,
        })),
      },
    });
    result.forEach((c: any) => catByName.set(c.name, c.id));
    logger.info(`[seed:catalog] created ${missingCats.length} categories`);
  }

  // ── 6. Products (idempotent by handle, chunked) ──
  const { data: existingProds } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    pagination: { take: 5000 },
  });
  const haveHandles = new Set(existingProds.map((p: any) => p.handle));
  const toCreate = ALL.filter((p) => !haveHandles.has(p.handle));

  const CHUNK = 50;
  let created = 0;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const batch = toCreate.slice(i, i + CHUNK);
    await createProductsWorkflow(container).run({
      input: {
        products: batch.map((p) => ({
          title: p.title,
          handle: p.handle,
          status: ProductStatus.PUBLISHED,
          category_ids: [catByName.get(p.category)!],
          shipping_profile_id: shippingProfile.id,
          sales_channels: [{ id: defaultSalesChannel.id }],
          metadata: { brand: p.brand },
          options: [{ title: OPTION_TITLE, values: [OPTION_VALUE] }],
          variants: [
            {
              title: p.title,
              sku: p.handle.toUpperCase(),
              manage_inventory: true,
              options: { [OPTION_TITLE]: OPTION_VALUE },
              prices: [{ amount: p.price, currency_code: "vnd" }],
            },
          ],
        })),
      },
    });
    created += batch.length;
    logger.info(`[seed:catalog] products ${created}/${toCreate.length}`);
  }
  if (!toCreate.length)
    logger.info("[seed:catalog] all products already exist — skip");

  // ── 7. Inventory levels (idempotent) ──
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "location_levels.location_id"],
    pagination: { take: 5000 },
  });
  const levels = inventoryItems
    .filter(
      (ii: any) =>
        !(ii.location_levels ?? []).some(
          (l: any) => l.location_id === stockLocation.id,
        ),
    )
    .map((ii: any) => ({
      inventory_item_id: ii.id,
      location_id: stockLocation.id,
      stocked_quantity: 1000,
    }));
  if (levels.length) {
    // chunk inventory levels too
    for (let i = 0; i < levels.length; i += 200) {
      await createInventoryLevelsWorkflow(container).run({
        input: { inventory_levels: levels.slice(i, i + 200) },
      });
    }
    logger.info(`[seed:catalog] created ${levels.length} inventory levels`);
  }

  logger.info("[seed:catalog] done.");
}

import { MedusaContainer } from '@medusajs/framework'
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from '@medusajs/framework/utils'
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'
import { S3_IMAGES } from '../data/product-images.generated'

/**
 * Badminton catalog seed (VND).
 *
 * Init data for the team: run once on a fresh DB after migrations so everyone
 * has ready-to-use products. Categories match the SuggestiveSelling
 * CategoryComplementMapping (Rackets → Strings/Grips/Bags; Shoes → Socks/Insoles;
 * Shuttlecocks → Tubes), so the Tier-2 seed can resolve them afterwards.
 *
 * Run:  npx medusa exec ./src/migration-scripts/initial-data-seed.ts
 *   (or pnpm --filter @dtc/backend seed)
 * Then: npx medusa exec ./src/scripts/seed-suggestive-selling.ts
 *
 * Idempotent guard: skips entirely if a Default Sales Channel already exists.
 * All money is VND (integer, no minor units — SRS INT-01).
 */

const CATEGORY_NAMES = [
  'Rackets',
  'Strings',
  'Grips',
  'Bags',
  'Shoes',
  'Socks',
  'Insoles',
  'Shuttlecocks',
  'Tubes',
] as const

// Mock image placeholder for products without real photos yet.
const mockImg = (handle: string) =>
  `https://placehold.co/800x800/png?text=${encodeURIComponent(handle)}`

// Real product photos (S3) live in ../data/product-images.generated.ts —
// regenerated from the DB after uploads. Missing products fall back to mockImg.

type ProductSeed = {
  title: string
  handle: string
  category: (typeof CATEGORY_NAMES)[number]
  description: string
  weight: number
  variants: { title: string; sku: string; price: number }[]
  optionTitle: string
}

// Single-variant helper (most accessories/rackets have one SKU).
function single(
  title: string,
  handle: string,
  sku: string,
  category: ProductSeed['category'],
  price: number,
  description: string,
  weight = 200
): ProductSeed {
  return {
    title,
    handle,
    category,
    description,
    weight,
    optionTitle: 'Default',
    variants: [{ title: 'Default', sku, price }],
  }
}

// Sized helper (shoes come in multiple sizes → multi-variant, no default).
function sized(
  title: string,
  handle: string,
  skuBase: string,
  category: ProductSeed['category'],
  price: number,
  description: string,
  sizes: string[],
  weight = 700
): ProductSeed {
  return {
    title,
    handle,
    category,
    description,
    weight,
    optionTitle: 'Size',
    variants: sizes.map((s) => ({ title: s, sku: `${skuBase}-${s}`, price })),
  }
}

const PRODUCTS: ProductSeed[] = [
  // ── Vợt (Rackets) ──
  single('Yonex Astrox 99 Pro', 'yonex-astrox-99-pro', 'RKT-AX99PRO', 'Rackets', 4_500_000, 'Vợt tấn công đầu nặng, cây vợt tín nhiệm của Kento Momota.', 90),
  single('Li-Ning Axforce 80', 'lining-axforce-80', 'RKT-AXF80', 'Rackets', 3_200_000, 'Vợt công thủ toàn diện, khung khí động học.', 88),
  single('Victor Thruster Ryuga II', 'victor-thruster-ryuga-2', 'RKT-TKRYUGA2', 'Rackets', 3_800_000, 'Vợt tấn công tốc độ cao, đầu nặng vừa.', 89),
  single('Yonex Nanoflare 800', 'yonex-nanoflare-800', 'RKT-NF800', 'Rackets', 4_100_000, 'Vợt phòng thủ - tốc độ, đầu nhẹ vụt nhanh.', 83),

  // ── Dây cước (Strings) ──
  single('Yonex BG65', 'yonex-bg65', 'STR-BG65', 'Strings', 120_000, 'Dây cước bền phổ thông, phù hợp người mới.', 20),
  single('Yonex BG80 Power', 'yonex-bg80-power', 'STR-BG80P', 'Strings', 150_000, 'Dây cước lực đánh mạnh, âm thanh giòn.', 20),
  single('Li-Ning No.1', 'lining-no1-string', 'STR-LNNO1', 'Strings', 130_000, 'Dây cước cân bằng lực và độ bền.', 20),

  // ── Quấn cán (Grips) ──
  single('Yonex AC102 Towel Grip', 'yonex-ac102-towel-grip', 'GRP-AC102', 'Grips', 90_000, 'Quấn cán khăn thấm mồ hôi tốt.', 30),
  single('Yonex Super Grap AC104', 'yonex-super-grap-ac104', 'GRP-AC104', 'Grips', 110_000, 'Quấn cán mỏng bám tay, cuộn 3 cái.', 30),
  single('Victor GR262', 'victor-gr262-grip', 'GRP-GR262', 'Grips', 70_000, 'Quấn cán cơ bản, giá tốt.', 30),

  // ── Bao/Túi (Bags) ──
  single('Yonex Pro Racket Bag 92026', 'yonex-pro-bag-92026', 'BAG-92026', 'Bags', 1_800_000, 'Túi vợt cao cấp 6 ngăn, giữ nhiệt.', 1500),
  single('Victor BR9213', 'victor-br9213-bag', 'BAG-BR9213', 'Bags', 1_200_000, 'Túi vợt 2 ngăn tiện dụng.', 1300),

  // ── Giày (Shoes) — đa size ──
  sized('Yonex Power Cushion 65Z3', 'yonex-pc-65z3', 'SHO-65Z3', 'Shoes', 2_200_000, 'Giày cầu lông đế êm, chống trơn.', ['40', '41', '42', '43']),
  sized('Victor A970', 'victor-a970', 'SHO-A970', 'Shoes', 1_900_000, 'Giày ổn định, ôm chân.', ['40', '41', '42', '43']),
  sized('Li-Ning Ranger', 'lining-ranger', 'SHO-RANGER', 'Shoes', 1_600_000, 'Giày phổ thông nhẹ.', ['40', '41', '42']),

  // ── Tất (Socks) ──
  single('Yonex Sport Socks 19120', 'yonex-socks-19120', 'SOC-19120', 'Socks', 120_000, 'Tất thể thao dày, thấm hút.', 50),
  single('Victor SK155', 'victor-sk155-socks', 'SOC-SK155', 'Socks', 90_000, 'Tất cổ ngắn thoáng khí.', 50),

  // ── Lót giày (Insoles) ──
  single('Yonex Power Cushion Insole', 'yonex-pc-insole', 'INS-PC01', 'Insoles', 350_000, 'Lót giày giảm chấn Power Cushion.', 80),

  // ── Cầu (Shuttlecocks) ──
  single('Yonex Mavis 350 (nhựa)', 'yonex-mavis-350', 'SHU-MAVIS350', 'Shuttlecocks', 350_000, 'Cầu nhựa bền, tập luyện, hộp 6 quả.', 120),
  single('Yonex Aerosensa 30 (lông)', 'yonex-as30', 'SHU-AS30', 'Shuttlecocks', 850_000, 'Cầu lông vũ thi đấu, hộp 12 quả.', 130),

  // ── Ống cầu bulk (Tubes) ──
  single('Yonex AS30 3-Tube combo 3 ống', 'yonex-as30-3tube', 'TUB-AS30X3', 'Tubes', 2_300_000, 'Combo 3 ống cầu Aerosensa 30, giá tốt hơn/ống.', 380),
]

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const fulfillmentModuleService = container.resolve(ModuleRegistrationName.FULFILLMENT)

  // Idempotent guard — don't double-seed.
  const already = await salesChannelModule.listSalesChannels({ name: 'Default Sales Channel' })
  if (already.length) {
    logger.warn('[seed] Default Sales Channel already exists — DB looks seeded. Skipping.')
    return
  }

  const countries = ['vn']

  logger.info('[seed] store + sales channel...')
  const {
    result: [defaultSalesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: 'Default Sales Channel', description: 'HF Badminton' }] },
  })

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [{ title: 'Default Publishable API Key', type: 'publishable', created_by: '' }],
    },
  })
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [defaultSalesChannel.id] },
  })

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: 'HF Badminton Store',
          supported_currencies: [{ currency_code: 'vnd', is_default: true }],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      ],
    },
  })

  logger.info('[seed] region + tax (Vietnam / VND)...')
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: 'Vietnam',
          currency_code: 'vnd',
          countries,
          payment_providers: ['pp_system_default'],
        },
      ],
    },
  })
  const region = regionResult[0]
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({ country_code, provider_id: 'tp_system' })),
  })

  logger.info('[seed] stock location + fulfillment...')
  const { result: stockLocationResult } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: 'HCMC Warehouse',
          address: { city: 'Ho Chi Minh City', country_code: 'VN', address_1: '' },
        },
      ],
    },
  })
  const stockLocation = stockLocationResult[0]

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: 'manual_manual' },
  })

  const { data: shippingProfileResult } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })
  const shippingProfile = shippingProfileResult[0]

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: 'Vietnam delivery',
    type: 'shipping',
    service_zones: [
      { name: 'Vietnam', geo_zones: [{ country_code: 'vn', type: 'country' }] },
    ],
  })
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: 'Standard Shipping',
        price_type: 'flat',
        provider_id: 'manual_manual',
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: { label: 'Standard', description: 'Giao 2-3 ngày.', code: 'standard' },
        prices: [
          { currency_code: 'vnd', amount: 30_000 },
          { region_id: region.id, amount: 30_000 },
        ],
        rules: [
          { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
          { attribute: 'is_return', value: 'false', operator: 'eq' },
        ],
      },
      {
        name: 'Express Shipping',
        price_type: 'flat',
        provider_id: 'manual_manual',
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: { label: 'Express', description: 'Giao trong 24h.', code: 'express' },
        prices: [
          { currency_code: 'vnd', amount: 60_000 },
          { region_id: region.id, amount: 60_000 },
        ],
        rules: [
          { attribute: 'enabled_in_store', value: 'true', operator: 'eq' },
          { attribute: 'is_return', value: 'false', operator: 'eq' },
        ],
      },
    ],
  })

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [defaultSalesChannel.id] },
  })

  logger.info('[seed] categories...')
  const { result: categoryResult } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: CATEGORY_NAMES.map((name) => ({ name, is_active: true })),
    },
  })
  const catId = (name: string) => categoryResult.find((c) => c.name === name)!.id

  logger.info(`[seed] ${PRODUCTS.length} products...`)
  await createProductsWorkflow(container).run({
    input: {
      products: PRODUCTS.map((p) => ({
        title: p.title,
        handle: p.handle,
        description: p.description,
        weight: p.weight,
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfile.id,
        thumbnail: S3_IMAGES[p.handle]?.thumbnail ?? mockImg(p.handle),
        images: (S3_IMAGES[p.handle]?.images ?? [mockImg(p.handle)]).map((url) => ({ url })),
        category_ids: [catId(p.category)],
        options: [{ title: p.optionTitle, values: p.variants.map((v) => v.title) }],
        variants: p.variants.map((v) => ({
          title: v.title,
          sku: v.sku,
          manage_inventory: true,
          options: { [p.optionTitle]: v.title },
          prices: [{ amount: v.price, currency_code: 'vnd' }],
        })),
        sales_channels: [{ id: defaultSalesChannel.id }],
      })),
    },
  })

  logger.info('[seed] inventory levels...')
  const { data: inventoryItems } = await query.graph({
    entity: 'inventory_item',
    fields: ['id'],
  })
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryItems.map((item) => ({
        location_id: stockLocation.id,
        stocked_quantity: 1000,
        inventory_item_id: item.id,
      })),
    },
  })

  logger.info(
    `[seed] Done. ${CATEGORY_NAMES.length} categories, ${PRODUCTS.length} products (VND). ` +
      `Next: npx medusa exec ./src/scripts/seed-suggestive-selling.ts`
  )
}

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { SUGGESTIVE_SELLING_MODULE } from '../modules/suggestive-selling'
import { bumpCartRuleVersion } from '../lib/suggestion-cache'

/**
 * Seed for the SuggestiveSelling module Ã¢â‚¬â€ run with:
 *   npx medusa exec ./src/scripts/seed-suggestive-selling.ts
 *
 * Seeds two things (SRS SUGG-001), resolving catalog by name/handle so it must
 * run AFTER the catalog seed. Idempotent: clears its own data before inserting.
 *   1. Tier-2 category complement mapping (category Ã¢â€ â€™ complementary categories).
 *   2. Tier-1 manual product rules (source product Ã¢â€ â€™ specific suggested products).
 */

// Tier-2: source category Ã¢â€ â€™ complementary categories (by name).
const COMPLEMENT_MAP: Record<string, string[]> = {
  Rackets: ['Strings', 'Grips', 'Bags'],
  Shoes: ['Socks', 'Insoles'],
  Shuttlecocks: ['Tubes'],
}

// Tier-1: source product handle Ã¢â€ â€™ suggested product handles ("Complete Your Setup").
const TIER1_RULES: Record<string, { handle: string; label?: string }[]> = {
  'yonex-astrox-99-pro': [
    { handle: 'yonex-bg65', label: 'Best Match' },
    { handle: 'yonex-pro-bag-92026' },
    { handle: 'yonex-ac102-towel-grip' },
  ],
  'yonex-nanoflare-800': [
    { handle: 'yonex-bg80-power', label: 'Best Match' },
    { handle: 'yonex-super-grap-ac104' },
    { handle: 'victor-br9213-bag' },
  ],
  'lining-axforce-80': [
    { handle: 'lining-no1-string' },
    { handle: 'victor-gr262-grip' },
  ],
  'yonex-pc-65z3': [
    { handle: 'yonex-socks-19120' },
    { handle: 'yonex-pc-insole' },
  ],
  'victor-a970': [
    { handle: 'victor-sk155-socks' },
    { handle: 'yonex-pc-insole' },
  ],
}

export default async function seedSuggestiveSelling({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModule = container.resolve(Modules.PRODUCT)
  const ss: any = container.resolve(SUGGESTIVE_SELLING_MODULE)

  // List all categories then match by name in memory Ã¢â‚¬â€ array-filter on `name`
  // isn't reliably translated to an IN query by the module service.
  const categories = await productModule.listProductCategories(
    {},
    { select: ['id', 'name'], take: 1000 }
  )
  const idByName = new Map(categories.map((c: any) => [c.name, c.id]))

  const rows: Array<{
    source_category_id: string
    complement_category_id: string
    display_order: number
    is_active: boolean
  }> = []

  for (const [source, complements] of Object.entries(COMPLEMENT_MAP)) {
    const sourceId = idByName.get(source)
    if (!sourceId) {
      logger.warn(`[seed:suggestive] category "${source}" not found Ã¢â‚¬â€ skip (waiting on catalog seed)`)
      continue
    }
    complements.forEach((comp, order) => {
      const compId = idByName.get(comp)
      if (!compId) {
        logger.warn(`[seed:suggestive] complement category "${comp}" not found Ã¢â‚¬â€ skip`)
        return
      }
      rows.push({
        source_category_id: sourceId,
        complement_category_id: compId,
        display_order: order,
        is_active: true,
      })
    })
  }

  // Tier-2: idempotent wipe + insert.
  if (rows.length) {
    const existing = await ss.listCategoryComplementMappings({}, { select: ['id'] })
    if (existing.length) {
      await ss.deleteCategoryComplementMappings(existing.map((r: any) => r.id))
    }
    await ss.createCategoryComplementMappings(rows)
    logger.info(`[seed:suggestive] created ${rows.length} category complement mappings.`)
  } else {
    logger.info('[seed:suggestive] no category mappings (categories not seeded yet).')
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Tier-1: manual product rules (source product Ã¢â€ â€™ suggested products) Ã¢â€â‚¬Ã¢â€â‚¬
  const products = await productModule.listProducts({}, { select: ['id', 'handle'], take: 1000 })
  const idByHandle = new Map(products.map((p: any) => [p.handle, p.id]))

  // Idempotent: remove existing manual product-level rules (cascades to items).
  const existingRules = await ss.listSuggestionRules({}, { select: ['id', 'type', 'tier'] })
  const toDelete = existingRules
    .filter((r: any) => r.type === 'product' && r.tier === 'manual')
    .map((r: any) => r.id)
  if (toDelete.length) {
    await ss.deleteSuggestionRules(toDelete)
  }

  let created = 0
  for (const [sourceHandle, suggestions] of Object.entries(TIER1_RULES)) {
    const sourceId = idByHandle.get(sourceHandle)
    if (!sourceId) {
      logger.warn(`[seed:suggestive] source product "${sourceHandle}" not found Ã¢â‚¬â€ skip rule`)
      continue
    }
    const items = suggestions
      .map((s, order) => {
        const pid = idByHandle.get(s.handle)
        if (!pid) {
          logger.warn(`[seed:suggestive] suggested product "${s.handle}" not found Ã¢â‚¬â€ skip item`)
          return null
        }
        return { suggested_product_id: pid, display_order: order, custom_label: s.label ?? null }
      })
      .filter(Boolean)

    if (!items.length) continue

    const rule = await ss.createSuggestionRules({
      name: `Complete your setup: ${sourceHandle}`,
      type: 'product',
      tier: 'manual',
      priority: 10,
      is_active: true,
      items,
    })
    await link.create({
      [SUGGESTIVE_SELLING_MODULE]: {
        suggestion_rule_id: rule.id,
      },
      [Modules.PRODUCT]: {
        product_id: sourceId,
      },
    })
    created++
  }
  logger.info(`[seed:suggestive] created ${created} Tier-1 manual product rules.`)
  // Cart-level rules are dynamic strategies: no fixed suggestion items.
  const oldCartRules = await ss.listSuggestionRules({ type: 'cart' }, { select: ['id'] })
  if (oldCartRules.length) await ss.deleteSuggestionRules(oldCartRules.map((rule: any) => rule.id))

  const cartRules = [
    {
      name: 'CR-01 Category Gap', type: 'cart', tier: 'manual', priority: 1, is_active: true,
      conditions: [{ condition_type: 'category_missing', condition_params: { source_category_ids: [idByName.get('Rackets')].filter(Boolean) } }],
    },
    {
      name: 'CR-02 Threshold Near', type: 'cart', tier: 'manual', priority: 2, is_active: true,
      conditions: [{ condition_type: 'threshold_near', condition_params: { percentage: 0.15, badge_text: 'Add for FREE shipping!' } }],
    },
    {
      name: 'CR-03 Same Brand Accessories', type: 'cart', tier: 'manual', priority: 3, is_active: true,
      conditions: [{ condition_type: 'brand_match', condition_params: { accessory_category_ids: [] } }],
    },
    {
      name: 'CR-04 Consumable Bulk', type: 'cart', tier: 'manual', priority: 4, is_active: true,
      conditions: [{ condition_type: 'consumable_upsell', condition_params: { consumable_category_ids: [idByName.get('Shuttlecocks')].filter(Boolean), max_quantity: 1 } }],
    },
  ]
  for (const rule of cartRules) await ss.createSuggestionRules(rule)

  const existingBulk = await ss.listProductBulkMappings({}, { select: ['id'] })
  if (existingBulk.length) await ss.deleteProductBulkMappings(existingBulk.map((mapping: any) => mapping.id))
  const sourceProductId = idByHandle.get('yonex-mavis-350')
  const bulkProductId = idByHandle.get('yonex-shuttle-tube-bundle') ?? idByHandle.get('yonex-as30-3tube')
  if (sourceProductId && bulkProductId) {
    await ss.createProductBulkMappings({ source_product_id: sourceProductId, bulk_product_id: bulkProductId, pack_size: 3, priority: 0, is_active: true })
  } else {
    logger.warn('[seed:suggestive] CR-04 bulk product mapping skipped because catalog handles were not found.')
  }
  await bumpCartRuleVersion(container)
  logger.info(`[seed:suggestive] created ${cartRules.length} dynamic cart rules and clean bulk mappings.`)
}

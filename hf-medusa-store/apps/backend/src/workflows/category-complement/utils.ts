import { MedusaError } from '@medusajs/framework/utils'
import { AdminErrors } from '../../lib/errors'
import type { CategoryComplementInput } from './types'

export async function assertCategoryComplementUnique(service: any, input: CategoryComplementInput, excludeId?: string) {
  if (!input.source_category_id || !input.complement_category_id || input.source_category_id === input.complement_category_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Source and complement categories must be different')
  }
  const pairs = await service.listCategoryComplementMappings({ source_category_id: input.source_category_id, complement_category_id: input.complement_category_id }, { select: ['id'] })
  if (pairs.some((row: any) => row.id !== excludeId)) throw AdminErrors.complementPairDuplicate()
  const order = Number(input.display_order ?? 0)
  const orders = await service.listCategoryComplementMappings({ source_category_id: input.source_category_id, display_order: order }, { select: ['id'] })
  if (orders.some((row: any) => row.id !== excludeId)) throw AdminErrors.categoryDisplayOrderConflict(order)
}

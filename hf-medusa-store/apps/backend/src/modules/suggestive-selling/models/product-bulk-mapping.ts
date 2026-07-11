import { model } from '@medusajs/framework/utils'

/** Explicit single-product to bulk/multipack relationship for dynamic CR-04. */
const ProductBulkMapping = model.define('product_bulk_mapping', {
  id: model.id().primaryKey(),
  source_product_id: model.text(),
  bulk_product_id: model.text(),
  pack_size: model.number().default(2),
  priority: model.number().default(0),
  is_active: model.boolean().default(true),
}).indexes([{ on: ['source_product_id', 'is_active', 'priority'] }])

export default ProductBulkMapping

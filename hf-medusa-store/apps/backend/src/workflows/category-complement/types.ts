export type CategoryComplementInput = {
  source_category_id: string
  complement_category_id: string
  display_order?: number
  is_active?: boolean
}

export type CategoryComplementUpdateInput = Partial<CategoryComplementInput> & { id: string }

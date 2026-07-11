import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Sparkles } from '@medusajs/icons'
import {
  Container,
  Heading,
  Button,
  Checkbox,
  Table,
  Tabs,
  Badge,
  Drawer,
  Input,
  Label,
  Select,
  Text,
  toast,
  usePrompt,
} from '@medusajs/ui'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// Minimal Admin API helper using the cookie session.
async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}))
    throw new Error(msg?.customer_message || msg?.message || `${res.status} ${res.statusText}`)
  }
  return res.status === 204 ? {} : res.json()
}

type ItemInput = { suggested_product_id: string; custom_label: string }
type ConditionType = 'category_missing' | 'threshold_near' | 'brand_match' | 'consumable_upsell'
type ConditionInput = { condition_type: ConditionType; condition_params: string }
const defaultConditionParams = (type: ConditionType) => JSON.stringify(
  type === 'category_missing' ? { source_category_ids: [] }
    : type === 'threshold_near' ? { percentage: 0.15, badge_text: 'Add for FREE shipping!' }
      : type === 'brand_match' ? { accessory_category_ids: [] }
        : { consumable_category_ids: [], max_quantity: 1 },
  null,
  2
)
type RuleForm = {
  name: string
  type: 'product' | 'cart'
  tier: 'manual' | 'category' | 'behavioral'
  source_product_ids: string[]
  priority: number
  items: ItemInput[]
  conditions: ConditionInput[]
  source_category_id: string
  complement_category_ids: string[]
}

const EMPTY: RuleForm = {
  name: '',
  type: 'product',
  tier: 'manual',
  source_product_ids: [],
  priority: 0,
  items: [{ suggested_product_id: '', custom_label: '' }],
  conditions: [{ condition_type: 'threshold_near', condition_params: defaultConditionParams('threshold_near') }],
  source_category_id: '',
  complement_category_ids: [],
}

const PAGE_SIZE = 10

const SuggestionRulesPage = () => {
  const qc = useQueryClient()
  const prompt = usePrompt()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingComplementId, setEditingComplementId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY)
  const [productSearch, setProductSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'manual' | 'cart' | 'category'>('manual')
  const [rulePage, setRulePage] = useState(0)
  const [cartRulePage, setCartRulePage] = useState(0)
  const [mappingPage, setMappingPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['suggestion-rules', rulePage],
    queryFn: () =>
      api(`/suggestion-rules?type=product&tier=manual&limit=${PAGE_SIZE}&offset=${rulePage * PAGE_SIZE}`),
  })
  const { data: cartRuleData, isLoading: isCartLoading } = useQuery({
    queryKey: ['cart-suggestion-rules', cartRulePage],
    queryFn: () =>
      api(`/suggestion-rules?type=cart&tier=manual&limit=${PAGE_SIZE}&offset=${cartRulePage * PAGE_SIZE}`),
  })
  const { data: productData } = useQuery({
    queryKey: ['products-mini'],
    queryFn: () => api('/products?limit=200&fields=id,title'),
  })
  const { data: categoryData } = useQuery({
    queryKey: ['product-categories-mini'],
    queryFn: () => api('/product-categories?limit=200&fields=id,name'),
  })
  const { data: complementData } = useQuery({
    queryKey: ['category-complements', mappingPage],
    queryFn: () =>
      api(`/category-complements?limit=${PAGE_SIZE}&offset=${mappingPage * PAGE_SIZE}`),
  })
  const products = productData?.products ?? []
  const categories = categoryData?.product_categories ?? []
  const titleById = useMemo(
    () => new Map(products.map((p: any) => [p.id, p.title])),
    [products]
  )
  const categoryNameById = useMemo(
    () => new Map(categories.map((category: any) => [category.id, category.name])),
    [categories]
  )
  const categoryComplements = complementData?.category_complements ?? []
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const mapping of categoryComplements) {
      const current = groups.get(mapping.source_category_id) ?? []
      current.push(mapping)
      groups.set(mapping.source_category_id, current)
    }
    return [...groups.entries()]
      .map(([sourceCategoryId, mappings]) => ({
        source_category_id: sourceCategoryId,
        mappings: mappings.slice().sort((a, b) => a.display_order - b.display_order),
      }))
      .sort((a, b) =>
        String(categoryNameById.get(a.source_category_id) ?? a.source_category_id).localeCompare(
          String(categoryNameById.get(b.source_category_id) ?? b.source_category_id)
        )
      )
  }, [categoryComplements, categoryNameById])
  const visibleCategoryGroups = categoryGroups.slice(
    mappingPage * PAGE_SIZE,
    (mappingPage + 1) * PAGE_SIZE
  )

  const save = useMutation({
    mutationFn: async () => {
      if (form.tier === 'behavioral') {
        throw new Error('Behavioral suggestions are available in Phase 2.')
      }

      if (form.tier === 'category') {
        if (!form.source_category_id || !form.complement_category_ids.length) {
          throw new Error('Select a source category and at least one complement category.')
        }
        if (editingComplementId) {
          return api(`/category-complements/${editingComplementId}`, {
            method: 'PUT',
            body: JSON.stringify({
              source_category_id: form.source_category_id,
              complement_category_id: form.complement_category_ids[0],
              display_order: Number(form.priority) || 0,
              is_active: true,
            }),
          })
        }
        return Promise.all(
          form.complement_category_ids.map((complementCategoryId, index) =>
            api('/category-complements', {
              method: 'POST',
              body: JSON.stringify({
                source_category_id: form.source_category_id,
                complement_category_id: complementCategoryId,
                display_order: (Number(form.priority) || 0) + index,
                is_active: true,
              }),
            })
          )
        )
      }

      const payload = {
        name: form.name,
        type: form.type,
        tier: 'manual' as const,
        source_product_ids: form.type === 'product' ? form.source_product_ids : [],
        priority: Number(form.priority) || 0,
        items: form.type === 'product' ? form.items
          .filter((i) => i.suggested_product_id)
          .map((i, order) => ({
            suggested_product_id: i.suggested_product_id,
            display_order: order,
            custom_label: i.custom_label || null,
          })) : [],
        conditions: form.type === 'cart'
          ? form.conditions.map((condition) => ({
              condition_type: condition.condition_type,
              condition_params: JSON.parse(condition.condition_params || '{}'),
            }))
          : [],
      }
      return editingId
        ? api(`/suggestion-rules/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : api('/suggestion-rules', { method: 'POST', body: JSON.stringify(payload) })
    },
    onSuccess: () => {
      toast.success(form.tier === 'category' ? (editingComplementId ? 'Category mapping updated' : 'Category mappings created') : editingId ? 'Rule updated' : 'Rule created')
      qc.invalidateQueries({ queryKey: ['suggestion-rules'] })
      qc.invalidateQueries({ queryKey: ['cart-suggestion-rules'] })
      qc.invalidateQueries({ queryKey: ['category-complements'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/suggestion-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Rule deleted')
      qc.invalidateQueries({ queryKey: ['suggestion-rules'] })
      qc.invalidateQueries({ queryKey: ['cart-suggestion-rules'] })
      qc.invalidateQueries({ queryKey: ['category-complements'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const removeComplement = useMutation({
    mutationFn: (id: string) => api(`/category-complements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Category mapping deleted')
      qc.invalidateQueries({ queryKey: ['category-complements'] })
    },
    onError: (error: any) => toast.error(error.message),
  })

  const onDeleteComplement = async (mapping: any) => {
    const sourceName = categoryNameById.get(mapping.source_category_id) ?? mapping.source_category_id
    const complementName =
      categoryNameById.get(mapping.complement_category_id) ?? mapping.complement_category_id
    const ok = await prompt({
      title: 'Delete category complement',
      description: `Remove "${complementName}" from the complement list for "${sourceName}"?`,
    })
    if (ok) removeComplement.mutate(mapping.id)
  }

  const openCreate = (tier: RuleForm['tier'] = 'manual') => {
    setEditingId(null)
    setForm({ ...EMPTY, tier })
    setProductSearch('')
    setOpen(true)
  }
  const openEdit = (rule: any) => {
    setEditingComplementId(null)
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      type: rule.type,
      tier: rule.tier,
      source_product_ids: rule.source_product_ids ?? [],
      priority: rule.priority ?? 0,
      source_category_id: '',
      complement_category_ids: [],
      conditions: (rule.conditions ?? []).length
        ? rule.conditions.map((condition: any) => ({
            condition_type: condition.condition_type,
            condition_params: JSON.stringify(condition.condition_params ?? {}, null, 2),
          }))
        : [{ condition_type: 'threshold_near', condition_params: defaultConditionParams('threshold_near') }],
      items: (rule.items ?? []).length
        ? rule.items.map((i: any) => ({
            suggested_product_id: i.suggested_product_id,
            custom_label: i.custom_label ?? '',
          }))
        : [{ suggested_product_id: '', custom_label: '' }],
    })
    setProductSearch('')
    setOpen(true)
  }
  const openEditComplement = (mapping: any) => {
    setEditingId(null)
    setEditingComplementId(mapping.id)
    setForm({
      ...EMPTY,
      tier: 'category',
      source_category_id: mapping.source_category_id,
      complement_category_ids: [mapping.complement_category_id],
      priority: mapping.display_order,
    })
    setOpen(true)
  }
  const onDelete = async (rule: any) => {
    const ok = await prompt({
      title: 'Delete rule',
      description: `Delete "${rule.name}"? This soft-deletes the rule.`,
    })
    if (ok) remove.mutate(rule.id)
  }

  const setItem = (idx: number, patch: Partial<ItemInput>) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }))
  const addItem = () =>
    setForm((f) => ({ ...f, items: [...f.items, { suggested_product_id: '', custom_label: '' }] }))
  const removeItem = (idx: number) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  const conditionParams = (condition: ConditionInput): Record<string, any> => {
    try { return JSON.parse(condition.condition_params || '{}') } catch { return {} }
  }
  const setConditionParam = (index: number, key: string, value: unknown) => {
    const params = conditionParams(form.conditions[index])
    setCondition(index, { condition_params: JSON.stringify({ ...params, [key]: value }, null, 2) })
  }
  const setCondition = (index: number, patch: Partial<ConditionInput>) =>
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition
      ),
    }))
  const addCondition = () =>
    setForm((current) => ({
      ...current,
      conditions: [...current.conditions, { condition_type: 'threshold_near', condition_params: defaultConditionParams('threshold_near') }],
    }))
  const removeCondition = (index: number) =>
    setForm((current) => ({
      ...current,
      conditions: current.conditions.filter((_, conditionIndex) => conditionIndex !== index),
    }))
  const toggleSourceProduct = (productId: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      source_product_ids: checked
        ? [...new Set([...current.source_product_ids, productId])]
        : current.source_product_ids.filter((id) => id !== productId),
    }))

  const rules = data?.suggestion_rules ?? []
  const cartRules = cartRuleData?.suggestion_rules ?? []
  const cartRuleCount = cartRuleData?.count ?? 0
  const cartRulePageCount = Math.ceil(cartRuleCount / PAGE_SIZE)
  const ruleCount = data?.count ?? 0
  const rulePageCount = Math.ceil(ruleCount / PAGE_SIZE)
  const mappingCount = categoryGroups.length
  const mappingPageCount = Math.ceil(mappingCount / PAGE_SIZE)
  const visibleProducts = products.filter((product: any) =>
    product.title.toLowerCase().includes(productSearch.trim().toLowerCase())
  )

  const sourceProductSummary = (rule: any) => {
    const names = (rule.source_product_ids ?? []).map((id: string) => titleById.get(id) ?? id)
    if (!names.length) return '-'
    return names.length > 2
      ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
      : names.join(', ')
  }

  return (
    <Container className="overflow-hidden p-0">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'manual' | 'cart' | 'category')}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Suggestive Selling</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Configure product-level manual recommendations and category-based fallback rules.
            </Text>
          </div>
          <Button
            size="small"
            variant="primary"
            onClick={() => {
              openCreate(activeTab === 'category' ? 'category' : 'manual')
              if (activeTab === 'cart') setForm({ ...EMPTY, type: 'cart' })
            }}
          >
            {activeTab === 'category' ? 'Create category mapping' : activeTab === 'cart' ? 'Create cart rule' : 'Create manual rule'}
          </Button>
        </div>

        <Tabs.List className="border-y border-ui-border-base px-6">
          <Tabs.Trigger value="manual">Manual Product Rules (Tier 1)</Tabs.Trigger>
          <Tabs.Trigger value="cart">Cart Rules</Tabs.Trigger>
          <Tabs.Trigger value="category">Category Complements (Tier 2)</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="manual">
          <div className="px-6 py-4">
            <Heading level="h2">Manual Product Rules</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Link source products to explicitly curated suggested products. Lower priority numbers run first.
            </Text>
          </div>
          {isLoading ? (
            <div className="px-6 py-8">
              <Text>Loading...</Text>
            </div>
          ) : (
            <>
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Name</Table.HeaderCell>
                    <Table.HeaderCell>Source products</Table.HeaderCell>
                    <Table.HeaderCell>Items</Table.HeaderCell>
                    <Table.HeaderCell title="Lower numbers run first">Priority</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rules.map((rule: any) => (
                    <Table.Row key={rule.id}>
                      <Table.Cell>{rule.name}</Table.Cell>
                      <Table.Cell>
                        <div className="max-w-80 truncate" title={sourceProductSummary(rule)}>
                          {sourceProductSummary(rule)}
                        </div>
                      </Table.Cell>
                      <Table.Cell>{rule.items?.length ?? 0}</Table.Cell>
                      <Table.Cell>{rule.priority}</Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="small" variant="secondary" onClick={() => openEdit(rule)}>
                            Edit
                          </Button>
                          <Button size="small" variant="danger" onClick={() => onDelete(rule)}>
                            Delete
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                  {!rules.length && (
                    <Table.Row>
                      <Table.Cell>
                        <Text className="text-ui-fg-subtle">No manual rules yet.</Text>
                      </Table.Cell>
                      <Table.Cell />
                      <Table.Cell />
                      <Table.Cell />
                      <Table.Cell />
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
              <Table.Pagination
                count={ruleCount}
                pageSize={PAGE_SIZE}
                pageIndex={rulePage}
                pageCount={rulePageCount}
                canPreviousPage={rulePage > 0}
                canNextPage={rulePage + 1 < rulePageCount}
                previousPage={() => setRulePage((page) => Math.max(0, page - 1))}
                nextPage={() => setRulePage((page) => page + 1)}
              />
            </>
          )}
        </Tabs.Content>

        <Tabs.Content value="cart">
          <div className="px-6 py-4">
            <Heading level="h2">Cart Rules</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Configure cart-level rules, their conditions, and suggested products.
            </Text>
          </div>
          {isCartLoading ? <div className="px-6 py-8"><Text>Loading...</Text></div> : (
            <>
              <Table>
                <Table.Header><Table.Row>
                  <Table.HeaderCell>Name</Table.HeaderCell>
                  <Table.HeaderCell>Conditions</Table.HeaderCell>
                  <Table.HeaderCell>Items</Table.HeaderCell>
                  <Table.HeaderCell>Priority</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
                </Table.Row></Table.Header>
                <Table.Body>
                  {cartRules.map((rule: any) => (
                    <Table.Row key={rule.id}>
                      <Table.Cell>{rule.name}</Table.Cell>
                      <Table.Cell>{(rule.conditions ?? []).map((condition: any) => condition.condition_type).join(', ') || '-'}</Table.Cell>
                      <Table.Cell>{rule.items?.length ?? 0}</Table.Cell>
                      <Table.Cell>{rule.priority}</Table.Cell>
                      <Table.Cell className="text-right"><div className="flex justify-end gap-2">
                        <Button size="small" variant="secondary" onClick={() => openEdit(rule)}>Edit</Button>
                        <Button size="small" variant="danger" onClick={() => onDelete(rule)}>Delete</Button>
                      </div></Table.Cell>
                    </Table.Row>
                  ))}
                  {!cartRules.length && <Table.Row><Table.Cell><Text className="text-ui-fg-subtle">No cart rules yet.</Text></Table.Cell><Table.Cell /><Table.Cell /><Table.Cell /><Table.Cell /></Table.Row>}
                </Table.Body>
              </Table>
              <Table.Pagination count={cartRuleCount} pageSize={PAGE_SIZE} pageIndex={cartRulePage} pageCount={cartRulePageCount} canPreviousPage={cartRulePage > 0} canNextPage={cartRulePage + 1 < cartRulePageCount} previousPage={() => setCartRulePage((page) => Math.max(0, page - 1))} nextPage={() => setCartRulePage((page) => page + 1)} />
            </>
          )}
        </Tabs.Content>
        <Tabs.Content value="category">
          <div className="px-6 py-4">
            <Heading level="h2">Category Complements</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Each source category owns an ordered list of fallback categories. Lower display-order numbers are evaluated first.
            </Text>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Source category</Table.HeaderCell>
                <Table.HeaderCell>Ordered complement categories</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleCategoryGroups.map((group) => (
                <Table.Row key={group.source_category_id}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small" weight="plus">
                        {String(categoryNameById.get(group.source_category_id) ?? group.source_category_id)}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {group.mappings.length} complement categories
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-2">
                      {group.mappings.map((mapping: any) => (
                        <div
                          key={mapping.id}
                          className="flex items-center gap-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1"
                        >
                          <Badge size="2xsmall">#{mapping.display_order}</Badge>
                          <Text size="small">
                            {categoryNameById.get(mapping.complement_category_id) ??
                              mapping.complement_category_id}
                          </Text>
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={() => openEditComplement(mapping)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={() => onDeleteComplement(mapping)}
                            disabled={removeComplement.isPending}
                          >
                            X
                          </Button>
                        </div>
                      ))}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
              {!visibleCategoryGroups.length && (
                <Table.Row>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">No category mappings yet.</Text>
                  </Table.Cell>
                  <Table.Cell />
                </Table.Row>
              )}
            </Table.Body>
          </Table>
          <Table.Pagination
            count={mappingCount}
            pageSize={PAGE_SIZE}
            pageIndex={mappingPage}
            pageCount={mappingPageCount}
            canPreviousPage={mappingPage > 0}
            canNextPage={mappingPage + 1 < mappingPageCount}
            previousPage={() => setMappingPage((page) => Math.max(0, page - 1))}
            nextPage={() => setMappingPage((page) => page + 1)}
          />
        </Tabs.Content>
      </Tabs>

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>{editingComplementId ? 'Edit category mapping' : editingId ? 'Edit rule' : 'Create rule'}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <Label>Tier</Label>
              <Select
                value={form.tier}
                disabled={!!editingId || !!editingComplementId}
                onValueChange={(value: RuleForm['tier']) =>
                  setForm({
                    ...form,
                    tier: value,
                    type: 'product',
                    source_category_id: '',
                    complement_category_ids: [],
                  })
                }
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="manual">Manual</Select.Item>
                  <Select.Item value="category">Category complement</Select.Item>
                  <Select.Item value="behavioral">Behavioral</Select.Item>
                </Select.Content>
              </Select>
              {(editingId || editingComplementId) && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Tier cannot be changed while editing.
                </Text>
              )}
            </div>

            {form.tier === 'manual' && (
              <>
                <div className="flex flex-col gap-1">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Astrox 99 Pro setup"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label>Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(value: RuleForm['type']) => setForm({ ...form, type: value })}
                  >
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="product">Product</Select.Item>
                      <Select.Item value="cart">Cart</Select.Item>
                    </Select.Content>
                  </Select>
                </div>

                {form.type === 'product' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Source products</Label>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {form.source_product_ids.length} selected
                      </Text>
                    </div>
                    <Input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Search products..."
                    />
                    <div className="max-h-52 overflow-y-auto rounded border border-ui-border-base">
                      {visibleProducts.map((product: any) => {
                        const checked = form.source_product_ids.includes(product.id)
                        return (
                          <label
                            key={product.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-ui-border-base px-3 py-2 last:border-b-0"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                toggleSourceProduct(product.id, value === true)
                              }
                            />
                            <Text size="small">{product.title}</Text>
                          </label>
                        )
                      })}
                      {!visibleProducts.length && (
                        <Text size="small" className="block px-3 py-4 text-ui-fg-subtle">
                          No matching products.
                        </Text>
                      )}
                    </div>
                  </div>
                )}

                {form.type === 'cart' && (
                  <div className="flex flex-col gap-3 rounded border border-ui-border-base p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Cart conditions</Label>
                        <Text size="xsmall" className="text-ui-fg-subtle">All conditions must match for this rule to fire.</Text>
                      </div>
                      <Button size="small" variant="secondary" onClick={addCondition}>Add condition</Button>
                    </div>
                    {form.conditions.map((condition, index) => (
                      <div key={index} className="flex flex-col gap-2 rounded bg-ui-bg-subtle p-3">
                        <div className="flex items-center gap-2">
                          <Select value={condition.condition_type} onValueChange={(value: ConditionType) => setCondition(index, { condition_type: value, condition_params: defaultConditionParams(value) })}>
                            <Select.Trigger><Select.Value /></Select.Trigger>
                            <Select.Content>
                              <Select.Item value="category_missing">Category missing</Select.Item>
                              <Select.Item value="threshold_near">Threshold near</Select.Item>
                              <Select.Item value="brand_match">Brand match</Select.Item>
                              <Select.Item value="consumable_upsell">Consumable upsell</Select.Item>
                            </Select.Content>
                          </Select>
                          <Button size="small" variant="transparent" onClick={() => removeCondition(index)} disabled={form.conditions.length === 1}>X</Button>
                        </div>
                        {condition.condition_type === 'category_missing' && (
                          <Select value={(conditionParams(condition).source_category_ids ?? [])[0] ?? ''} onValueChange={(value) => setConditionParam(index, 'source_category_ids', [value])}>
                            <Select.Trigger><Select.Value placeholder="Source category" /></Select.Trigger>
                            <Select.Content>{categories.map((category: any) => <Select.Item key={category.id} value={category.id}>{category.name}</Select.Item>)}</Select.Content>
                          </Select>
                        )}
                        {condition.condition_type === 'threshold_near' && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input type="number" step="0.01" min="0" max="1" value={conditionParams(condition).percentage ?? 0.15} onChange={(event) => setConditionParam(index, 'percentage', Number(event.target.value))} placeholder="Percentage" />
                          </div>
                        )}
                        {condition.condition_type === 'brand_match' && (
                          <Select value={(conditionParams(condition).accessory_category_ids ?? [])[0] ?? ''} onValueChange={(value) => setConditionParam(index, 'accessory_category_ids', [value])}>
                            <Select.Trigger><Select.Value placeholder="Accessory category (optional)" /></Select.Trigger>
                            <Select.Content>{categories.map((category: any) => <Select.Item key={category.id} value={category.id}>{category.name}</Select.Item>)}</Select.Content>
                          </Select>
                        )}
                        {condition.condition_type === 'consumable_upsell' && (
                          <div className="grid grid-cols-2 gap-2">
                            <Select value={(conditionParams(condition).consumable_category_ids ?? [])[0] ?? ''} onValueChange={(value) => setConditionParam(index, 'consumable_category_ids', [value])}>
                              <Select.Trigger><Select.Value placeholder="Consumable category" /></Select.Trigger>
                              <Select.Content>{categories.map((category: any) => <Select.Item key={category.id} value={category.id}>{category.name}</Select.Item>)}</Select.Content>
                            </Select>
                            <Input type="number" min="0" value={conditionParams(condition).max_quantity ?? 1} onChange={(event) => setConditionParam(index, 'max_quantity', Number(event.target.value))} placeholder="Max quantity" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(event) =>
                      setForm({ ...form, priority: Number(event.target.value) })
                    }
                  />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Lower numbers run first. Priority 9 runs before priority 10.
                  </Text>
                </div>

                {form.type === 'product' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Suggested items</Label>
                    <Button size="small" variant="secondary" onClick={addItem}>
                      Add item
                    </Button>
                  </div>
                  {form.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <Select
                        value={item.suggested_product_id}
                        onValueChange={(value) =>
                          setItem(index, { suggested_product_id: value })
                        }
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Product..." />
                        </Select.Trigger>
                        <Select.Content>
                          {products.map((product: any) => (
                            <Select.Item key={product.id} value={product.id}>
                              {product.title}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                      <Input
                        placeholder="Label (optional)"
                        value={item.custom_label}
                        onChange={(event) =>
                          setItem(index, { custom_label: event.target.value })
                        }
                      />
                      <Button
                        size="small"
                        variant="transparent"
                        onClick={() => removeItem(index)}
                        disabled={form.items.length === 1}
                      >
                        X
                      </Button>
                    </div>
                  ))}
                </div>
                )}
              </>
            )}

            {form.tier === 'category' && (
              <>
                <div className="flex flex-col gap-1">
                  <Label>Source category</Label>
                  <Select
                    value={form.source_category_id}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        source_category_id: value,
                        complement_category_ids: form.complement_category_ids.filter(
                          (categoryId) => categoryId !== value
                        ),
                      })
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select a source category" />
                    </Select.Trigger>
                    <Select.Content>
                      {categories.map((category: any) => (
                        <Select.Item key={category.id} value={category.id}>
                          {category.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Complement categories</Label>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {form.complement_category_ids.length} selected
                    </Text>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded border border-ui-border-base">
                    {categories
                      .filter((category: any) => category.id !== form.source_category_id)
                      .map((category: any) => {
                        const checked = form.complement_category_ids.includes(category.id)
                        return (
                          <label
                            key={category.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-ui-border-base px-3 py-2 last:border-b-0"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                setForm({
                                  ...form,
                                  complement_category_ids:
                                    value === true
                                      ? editingComplementId
                                        ? [category.id]
                                        : [...new Set([...form.complement_category_ids, category.id])]
                                      : form.complement_category_ids.filter(
                                          (categoryId) => categoryId !== category.id
                                        ),
                                })
                              }
                            />
                            <Text size="small">{category.name}</Text>
                          </label>
                        )
                      })}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label>{editingComplementId ? 'Display order' : 'Starting display order'}</Label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(event) =>
                      setForm({ ...form, priority: Number(event.target.value) })
                    }
                  />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {editingComplementId
                      ? 'Order must be unique within this source category. Lower numbers run first.'
                      : 'Orders must be unique within this source category. Selected complements receive consecutive values.'}
                  </Text>
                </div>
              </>
            )}

            {form.tier === 'behavioral' && (
              <div className="rounded border border-ui-border-base bg-ui-bg-subtle p-4">
                <Heading level="h2">Available in Phase 2</Heading>
                <Text size="small" className="mt-2 text-ui-fg-subtle">
                  Behavioral suggestions require customer browsing and purchase signals. The schema is
                  ready, but evaluation and configuration are not enabled in Phase 1.
                </Text>
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
            <Button
              onClick={() => save.mutate()}
              isLoading={save.isPending}
              disabled={
                form.tier === 'behavioral' ||
                (form.tier === 'manual'
                  ? !form.name
                  : !form.source_category_id || !form.complement_category_ids.length)
              }
            >
              {form.tier === 'behavioral' ? 'Unavailable' : form.tier === 'category' ? (editingComplementId ? 'Save mapping' : 'Create mappings') : editingId ? 'Save' : 'Create'}
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Suggestive Selling',
  icon: Sparkles,
})

export default SuggestionRulesPage

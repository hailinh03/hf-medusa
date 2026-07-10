import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Sparkles } from '@medusajs/icons'
import {
  Container,
  Heading,
  Button,
  Checkbox,
  Table,
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
type RuleForm = {
  name: string
  type: 'product' | 'cart'
  tier: 'manual' | 'category' | 'behavioral'
  source_product_ids: string[]
  priority: number
  items: ItemInput[]
}

const EMPTY: RuleForm = {
  name: '',
  type: 'product',
  tier: 'manual',
  source_product_ids: [],
  priority: 0,
  items: [{ suggested_product_id: '', custom_label: '' }],
}

const SuggestionRulesPage = () => {
  const qc = useQueryClient()
  const prompt = usePrompt()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY)
  const [productSearch, setProductSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['suggestion-rules'],
    queryFn: () => api('/suggestion-rules?limit=100'),
  })
  const { data: productData } = useQuery({
    queryKey: ['products-mini'],
    queryFn: () => api('/products?limit=200&fields=id,title'),
  })
  const products = productData?.products ?? []
  const titleById = useMemo(
    () => new Map(products.map((p: any) => [p.id, p.title])),
    [products]
  )

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        tier: form.tier,
        source_product_ids: form.type === 'product' ? form.source_product_ids : [],
        priority: Number(form.priority) || 0,
        items: form.items
          .filter((i) => i.suggested_product_id)
          .map((i, order) => ({
            suggested_product_id: i.suggested_product_id,
            display_order: order,
            custom_label: i.custom_label || null,
          })),
        conditions: [],
      }
      return editingId
        ? api(`/suggestion-rules/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : api('/suggestion-rules', { method: 'POST', body: JSON.stringify(payload) })
    },
    onSuccess: () => {
      toast.success(editingId ? 'Rule updated' : 'Rule created')
      qc.invalidateQueries({ queryKey: ['suggestion-rules'] })
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/suggestion-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Rule deleted')
      qc.invalidateQueries({ queryKey: ['suggestion-rules'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY)
    setProductSearch('')
    setOpen(true)
  }
  const openEdit = (rule: any) => {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      type: rule.type,
      tier: rule.tier,
      source_product_ids: rule.source_product_ids ?? [],
      priority: rule.priority ?? 0,
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

  const toggleSourceProduct = (productId: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      source_product_ids: checked
        ? [...new Set([...current.source_product_ids, productId])]
        : current.source_product_ids.filter((id) => id !== productId),
    }))

  const rules = data?.suggestion_rules ?? []
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
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Suggestion Rules</Heading>
        <Button size="small" variant="primary" onClick={openCreate}>
          Create
        </Button>
      </div>

      {isLoading ? (
        <div className="px-6 py-8">
          <Text>Loading...</Text>
        </div>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Tier</Table.HeaderCell>
              <Table.HeaderCell>Source products</Table.HeaderCell>
              <Table.HeaderCell>Items</Table.HeaderCell>
              <Table.HeaderCell>Priority</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rules.map((r: any) => (
              <Table.Row key={r.id}>
                <Table.Cell>{r.name}</Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall">{r.type}</Badge>
                </Table.Cell>
                <Table.Cell>{r.tier}</Table.Cell>
                <Table.Cell>
                  <div className="max-w-80 truncate" title={sourceProductSummary(r)}>
                    {sourceProductSummary(r)}
                  </div>
                </Table.Cell>
                <Table.Cell>{r.items?.length ?? 0}</Table.Cell>
                <Table.Cell>{r.priority}</Table.Cell>
                <Table.Cell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="small" variant="secondary" onClick={() => openEdit(r)}>
                      Edit
                    </Button>
                    <Button size="small" variant="danger" onClick={() => onDelete(r)}>
                      Delete
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
            {!rules.length && (
              <Table.Row>
                <Table.Cell>
                  <Text className="text-ui-fg-subtle">No rules yet.</Text>
                </Table.Cell>
                {Array.from({ length: 6 }).map((_, index) => (
                  <Table.Cell key={index} />
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>{editingId ? 'Edit rule' : 'Create rule'}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Astrox 99 Pro setup"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v: any) => setForm({ ...form, type: v })}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="product">product</Select.Item>
                    <Select.Item value="cart">cart</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Tier</Label>
                <Select value={form.tier} onValueChange={(v: any) => setForm({ ...form, tier: v })}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="manual">manual</Select.Item>
                    <Select.Item value="category">category</Select.Item>
                    <Select.Item value="behavioral">behavioral</Select.Item>
                  </Select.Content>
                </Select>
              </div>
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

            <div className="flex flex-col gap-1">
              <Label>Priority</Label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Suggested items</Label>
                <Button size="small" variant="secondary" onClick={addItem}>
                  Add item
                </Button>
              </div>
              {form.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Select
                      value={it.suggested_product_id}
                      onValueChange={(v) => setItem(idx, { suggested_product_id: v })}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Product..." />
                      </Select.Trigger>
                      <Select.Content>
                        {products.map((p: any) => (
                          <Select.Item key={p.id} value={p.id}>
                            {p.title}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <Input
                    placeholder="Label (optional)"
                    value={it.custom_label}
                    onChange={(e) => setItem(idx, { custom_label: e.target.value })}
                  />
                  <Button
                    size="small"
                    variant="transparent"
                    onClick={() => removeItem(idx)}
                    disabled={form.items.length === 1}
                  >

                  </Button>
                </div>
              ))}
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
            <Button onClick={() => save.mutate()} isLoading={save.isPending} disabled={!form.name}>
              {editingId ? 'Save' : 'Create'}
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Suggestion Rules',
  icon: Sparkles,
})

export default SuggestionRulesPage

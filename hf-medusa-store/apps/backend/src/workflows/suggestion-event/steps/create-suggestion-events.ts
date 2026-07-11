import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { SUGGESTIVE_SELLING_MODULE } from '../../../modules/suggestive-selling'
import type { SuggestionEventInput } from '../types'

export const createSuggestionEventsStep = createStep('create-suggestion-events', async ({ events, best_effort = false }: { events: SuggestionEventInput[]; best_effort?: boolean }, { container }) => {
  if (!events.length) return new StepResponse({ events: [], accepted: 0 }, { ids: [] as string[] })
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  try {
    const created = await service.createSuggestionEvents(events)
    const rows = Array.isArray(created) ? created : [created]
    return new StepResponse({ events: rows, accepted: rows.length }, { ids: rows.map((row: any) => row.id) })
  } catch (error) {
    if (!best_effort) throw error
    return new StepResponse({ events: [], accepted: 0 }, { ids: [] as string[] })
  }
}, async (data, { container }) => {
  if (!data?.ids.length) return
  const service: any = container.resolve(SUGGESTIVE_SELLING_MODULE)
  await service.deleteSuggestionEvents(data.ids)
})

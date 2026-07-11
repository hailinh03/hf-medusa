import type { UpdateSuggestionRuleBody } from '../../api/admin/suggestion-rules/validators'

export type RuleUpdateInput = UpdateSuggestionRuleBody & { id: string }

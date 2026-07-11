import { defineRouteConfig } from '@medusajs/admin-sdk'
import SuggestionRulesManager from '../../../components/suggestive-selling/manager'

const ProductLevelSuggestionsPage = () => <SuggestionRulesManager mode="product" />

export const config = defineRouteConfig({ label: 'Product Level', rank: 1 })
export default ProductLevelSuggestionsPage

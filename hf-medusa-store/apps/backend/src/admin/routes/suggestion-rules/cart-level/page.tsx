import { defineRouteConfig } from '@medusajs/admin-sdk'
import SuggestionRulesManager from '../../../components/suggestive-selling/manager'

const CartLevelSuggestionsPage = () => <SuggestionRulesManager mode="cart" />

export const config = defineRouteConfig({ label: 'Cart Level', rank: 2 })
export default CartLevelSuggestionsPage

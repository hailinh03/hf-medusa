import { getProductSuggestions } from "@lib/data/suggestions"
import { getCartId } from "@lib/data/cookies"
import SuggestionRail from "../../components/suggestion-rail"

/**
 * "Complete Your Setup" — product-level section (SF-01 / SUGG-001).
 * Server component: fetches suggestions, hides entirely when empty (EC-05).
 * Rendered lazily (Suspense) so it never blocks the product page LCP.
 */
export default async function CompleteYourSetup({
  productId,
  countryCode,
  currencyCode,
}: {
  productId: string
  countryCode: string
  currencyCode: string
}) {
  const cartId = await getCartId()
  const { suggestions } = await getProductSuggestions({ productId, cartId })

  if (!suggestions.length) return null // hidden section, never an empty shell

  return (
    <section
      className="content-container my-10"
      data-testid="complete-your-setup"
    >
      <h2 className="text-xl-semi mb-6 text-ui-fg-base">
        Hoàn thiện bộ đồ của bạn
      </h2>
      <SuggestionRail
        context="product_view"
        items={suggestions}
        sourceProductId={productId}
        countryCode={countryCode}
        currencyCode={currencyCode}
      />
    </section>
  )
}

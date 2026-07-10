import { getCartSuggestions } from "@lib/data/suggestions"
import SuggestionRail from "../../components/suggestion-rail"
import ThresholdProgress from "../../components/threshold-progress"

/**
 * "You Might Also Need" — cart-level section (SF-02 / SUGG-004).
 * Server component: fetches cart suggestions + threshold_info, hides when empty.
 */
export default async function YouMightAlsoNeed({
  cartId,
  countryCode,
  currencyCode,
}: {
  cartId: string
  countryCode: string
  currencyCode: string
}) {
  const { suggestions, threshold_info } = await getCartSuggestions({ cartId })

  if (!suggestions.length && !threshold_info) return null

  return (
    <section className="my-8" data-testid="you-might-also-need">
      <h2 className="text-large-semi mb-4 text-ui-fg-base">
        Bạn có thể cần thêm
      </h2>
      {threshold_info ? (
        <ThresholdProgress info={threshold_info} currencyCode={currencyCode} />
      ) : null}
      {suggestions.length ? (
        <SuggestionRail
          context="cart"
          items={suggestions}
          countryCode={countryCode}
          currencyCode={currencyCode}
        />
      ) : null}
    </section>
  )
}

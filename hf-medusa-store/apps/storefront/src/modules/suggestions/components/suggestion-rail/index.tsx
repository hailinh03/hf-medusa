"use client"

import { clx } from "@modules/common/components/ui"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { convertToLocale } from "@lib/util/money"
import {
  addSuggestedItem,
  dismissSuggestion,
  syncSuggestionSession,
  trackSuggestionEvents,
  undoSuggestedAdd,
} from "@lib/data/suggestions"
import { Suggestion } from "../../types"

const SID_KEY = "sugg_sid"

type RailProps = {
  context: "product_view" | "cart"
  items: Suggestion[]
  sourceProductId?: string | null
  countryCode: string
  currencyCode: string
}

/** Ensure a stable per-browser session id (guest dismissal/analytics — D6). */
function useSessionId() {
  const [sid, setSid] = useState<string | null>(null)
  useEffect(() => {
    let id = ""
    try {
      id = localStorage.getItem(SID_KEY) || ""
      if (!id) {
        id =
          globalThis.crypto?.randomUUID?.() ??
          `sid_${Math.abs(Math.floor(performance.now() * 1000))}`
        localStorage.setItem(SID_KEY, id)
      }
    } catch {
      id = `sid_${Math.abs(Math.floor(performance.now() * 1000))}`
    }
    setSid(id)
    // mirror into a cookie so server-render GET can read the same scope
    syncSuggestionSession(id).catch(() => {})
  }, [])
  return sid
}

type Toast = { productName: string; lineItemId: string | null; key: number }

/**
 * SuggestionRail — client heart of the feature (SF-01/SF-03/SF-04/SF-05/SF-08).
 * Renders cards; handles one-tap Add (Added-state 3s + toast with 3s Undo),
 * dismiss (X, optimistic), impression/tap tracking. Add/dismiss/undo go through
 * server actions in lib/data/suggestions.ts.
 */
export default function SuggestionRail({
  context,
  items,
  sourceProductId,
  countryCode,
  currencyCode,
}: RailProps) {
  const sid = useSessionId()
  const [visible, setVisible] = useState<Suggestion[]>(items)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [errorId, setErrorId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => setVisible(items), [items])

  // ── Impression tracking: fire once per card when ≥50% visible ≥1s (SF-08) ──
  const seen = useRef<Set<string>>(new Set())
  const timers = useRef<Map<string, any>>(new Map())
  const cardRef = useCallback(
    (node: HTMLElement | null, s: Suggestion, slot: number) => {
      if (!node || seen.current.has(s.product_id)) return
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && e.intersectionRatio >= 0.5) {
              if (!timers.current.has(s.product_id)) {
                timers.current.set(
                  s.product_id,
                  setTimeout(() => {
                    if (seen.current.has(s.product_id)) return
                    seen.current.add(s.product_id)
                    trackSuggestionEvents([
                      {
                        action: "impression",
                        source_context: context,
                        suggested_product_id: s.product_id,
                        source_product_id: sourceProductId ?? null,
                        rule_id: s.rule_id,
                        tier: s.tier,
                        slot,
                      },
                    ]).catch(() => {})
                    obs.disconnect()
                  }, 1000),
                )
              }
            } else {
              const t = timers.current.get(s.product_id)
              if (t) {
                clearTimeout(t)
                timers.current.delete(s.product_id)
              }
            }
          }
        },
        { threshold: [0, 0.5, 1] },
      )
      obs.observe(node)
    },
    [context, sourceProductId],
  )

  const flashAdded = (productId: string) => {
    setAddedIds((prev) => new Set(prev).add(productId))
    setTimeout(() => {
      setAddedIds((prev) => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      })
    }, 3000) // "Added ✓" state for 3s (SUGG-003)
  }

  const handleTap = (s: Suggestion, slot: number) => {
    trackSuggestionEvents([
      {
        action: "tap",
        source_context: context,
        suggested_product_id: s.product_id,
        source_product_id: sourceProductId ?? null,
        rule_id: s.rule_id,
        tier: s.tier,
        slot,
      },
    ]).catch(() => {})
  }

  const handleAdd = (s: Suggestion) => {
    if (!s.variant_id) {
      // multi-variant no default → would open a selector; link to PDP instead
      setErrorId(s.product_id)
      return
    }
    setErrorId(null)
    startTransition(async () => {
      const res = await addSuggestedItem({
        variantId: s.variant_id!,
        productId: s.product_id,
        attribution: {
          rule_id: s.rule_id,
          source_context: context,
          source_product_id: sourceProductId ?? null,
        },
        countryCode,
      })
      if (res.ok) {
        flashAdded(s.product_id)
        setToast({
          productName: s.name,
          lineItemId: res.line_item_id,
          key: Date.now(),
        })
      } else if (res.code === "SUGGESTION_STOCK_CONFLICT") {
        // EC-07: remove the card + surface the friendly message
        setVisible((prev) => prev.filter((x) => x.product_id !== s.product_id))
        setToast({
          productName: res.message,
          lineItemId: null,
          key: Date.now(),
        })
      } else {
        setErrorId(s.product_id)
      }
    })
  }

  const handleUndo = () => {
    const t = toast
    setToast(null)
    if (t?.lineItemId) {
      startTransition(async () => {
        await undoSuggestedAdd(t.lineItemId!) // SF-04: not a dismissal
      })
    }
  }

  const handleDismiss = (s: Suggestion) => {
    setVisible((prev) => prev.filter((x) => x.product_id !== s.product_id)) // optimistic
    dismissSuggestion({
      sourceContext: context,
      productId: s.product_id,
      ruleId: s.rule_id,
      tier: s.tier,
      sourceProductId: sourceProductId ?? null,
    }).catch(() => {})
  }

  // Auto-dismiss the toast after the 3s Undo window.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  if (!visible.length) return null

  return (
    <div className="relative">
      <ul
        className="grid grid-cols-2 small:grid-cols-3 large:grid-cols-5 gap-x-4 gap-y-6"
        data-testid={`suggestions-${context}`}
      >
        {visible.map((s, i) => {
          const added = addedIds.has(s.product_id)
          const price = s.discount_price ?? s.price
          return (
            <li key={s.product_id}>
              <div
                ref={(node) => cardRef(node, s, i)}
                className="group relative flex h-full flex-col rounded-lg border border-ui-border-base bg-ui-bg-subtle p-2 transition-shadow hover:shadow-elevation-card-hover"
                data-testid="suggestion-card"
              >
                {/* dismiss (X) — SF-05 */}
                <button
                  type="button"
                  aria-label="Bỏ gợi ý"
                  onClick={() => handleDismiss(s)}
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-ui-bg-base/80 text-ui-fg-subtle opacity-0 transition-opacity hover:text-ui-fg-base group-hover:opacity-100"
                  data-testid="suggestion-dismiss"
                >
                  ✕
                </button>

                <LocalizedClientLink
                  href={`/products/${s.handle ?? ""}`}
                  onClick={() => handleTap(s, i)}
                  className="flex flex-1 flex-col"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-ui-bg-base">
                    {s.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.image_url}
                        alt={s.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    {s.label ? (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-ui-tag-blue-bg px-2 py-0.5 text-[10px] font-medium text-ui-tag-blue-text">
                        {s.label}
                      </span>
                    ) : null}
                    {s.badge_text ? (
                      <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-ui-tag-green-bg px-2 py-0.5 text-center text-[10px] font-medium text-ui-tag-green-text">
                        {s.badge_text}
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-2 line-clamp-2 text-xs text-ui-fg-base">
                    {s.name}
                  </span>
                  <span className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-ui-fg-base">
                      {price != null
                        ? convertToLocale({
                            amount: price,
                            currency_code: currencyCode,
                          })
                        : ""}
                    </span>
                    {s.discount_price != null && s.price != null ? (
                      <span className="text-[11px] text-ui-fg-muted line-through">
                        {convertToLocale({
                          amount: s.price,
                          currency_code: currencyCode,
                        })}
                      </span>
                    ) : null}
                  </span>
                </LocalizedClientLink>

                <button
                  type="button"
                  onClick={() => handleAdd(s)}
                  disabled={pending || added}
                  className={clx(
                    "mt-2 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    added
                      ? "bg-ui-tag-green-bg text-ui-tag-green-text"
                      : "bg-ui-button-inverted text-ui-fg-on-inverted hover:bg-ui-button-inverted-hover disabled:opacity-60",
                  )}
                  data-testid="suggestion-add"
                >
                  {added
                    ? "Đã thêm ✓"
                    : s.requires_variant_selection
                      ? "Chọn phân loại"
                      : "Thêm vào giỏ"}
                </button>
                {errorId === s.product_id ? (
                  <span className="mt-1 text-[10px] text-ui-fg-error">
                    {s.requires_variant_selection
                      ? "Sản phẩm nhiều loại — bấm để chọn."
                      : "Không thêm được. Bạn thử lại nhé!"}
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Toast + Undo (3s) — SF-03/SF-04 */}
      {toast ? (
        <div
          className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-lg bg-ui-bg-base px-4 py-3 shadow-elevation-flyout"
          role="status"
          data-testid="suggestion-toast"
        >
          <span className="text-sm text-ui-fg-base">
            {toast.lineItemId
              ? `Đã thêm ${toast.productName} vào giỏ`
              : toast.productName}
          </span>
          {toast.lineItemId ? (
            <button
              type="button"
              onClick={handleUndo}
              className="text-sm font-semibold text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              data-testid="suggestion-undo"
            >
              Hoàn tác
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

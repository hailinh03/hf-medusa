import { convertToLocale } from "@lib/util/money"
import { ThresholdInfo } from "../../types"

/**
 * CR-02 free-shipping progress (SUGG-004). Descriptive only — checkout shipping
 * calc stays authoritative (EC-06). Renders from `threshold_info`.
 */
export default function ThresholdProgress({
  info,
  currencyCode,
}: {
  info: ThresholdInfo
  currencyCode: string
}) {
  const pct = Math.max(
    0,
    Math.min(100, Math.round((info.current / info.target) * 100)),
  )
  return (
    <div
      className="mb-4 rounded-lg bg-ui-tag-green-bg/40 px-4 py-3"
      data-testid="threshold-progress"
    >
      <p className="text-sm text-ui-fg-base">
        Mua thêm{" "}
        <span className="font-semibold">
          {convertToLocale({
            amount: info.remaining,
            currency_code: currencyCode,
          })}
        </span>{" "}
        để được <span className="font-semibold">MIỄN PHÍ vận chuyển</span>!
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ui-bg-base">
        <div
          className="h-full rounded-full bg-ui-tag-green-icon transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

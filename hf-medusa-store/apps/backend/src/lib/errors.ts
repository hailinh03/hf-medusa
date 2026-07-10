/**
 * Standardized business errors — API_CONTRACT §3 / SPEC C.1.
 *
 * `BusinessError` carries a machine `code`, a Vietnamese `customer_message`
 * (safe to show), optional `details`, and the intended `httpStatus`. The
 * errorHandler (src/api/middlewares.ts) serializes it into the shared envelope.
 */

export type ErrorType =
  | "invalid_data"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unauthorized"
  | "not_allowed"
  | "server_error";

const TYPE_TO_STATUS: Record<ErrorType, number> = {
  invalid_data: 422, // business validation (override Medusa default 400)
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unauthorized: 401,
  not_allowed: 403,
  server_error: 500,
};

export class BusinessError extends Error {
  readonly code: string;
  readonly type: ErrorType;
  readonly httpStatus: number;
  readonly customerMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(args: {
    code: string;
    type: ErrorType;
    message: string; // internal (EN) — logs
    customerMessage: string; // VI — shown to customer
    details?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = "BusinessError";
    this.code = args.code;
    this.type = args.type;
    this.httpStatus = TYPE_TO_STATUS[args.type];
    this.customerMessage = args.customerMessage;
    this.details = args.details;
  }
}

/**
 * Error code catalog (API_CONTRACT §4/§5) — the ids used across the codebase,
 * paired with their Vietnamese customer message. Helpers below build the error.
 */
export const SuggestionErrors = {
  stockConflict: (product: string, productId?: string) =>
    new BusinessError({
      code: "SUGGESTION_STOCK_CONFLICT",
      type: "conflict",
      message: `variant out of stock at execution for product ${productId ?? product}`,
      customerMessage: `${product} vừa hết hàng. Chúng tôi đã cập nhật lại gợi ý cho bạn.`,
      details: productId ? { product_id: productId } : undefined,
    }),
  variantSelectionRequired: (variants: unknown[]) =>
    new BusinessError({
      code: "SUGGESTION_VARIANT_SELECTION_REQUIRED",
      type: "invalid_data",
      message:
        "multi-variant product with no default variant — selection required",
      customerMessage: "Bạn vui lòng chọn phân loại sản phẩm nhé!",
      details: { variants },
    }),
  invalidAttribution: (ruleId?: string) =>
    new BusinessError({
      code: "SUGGESTION_INVALID_ATTRIBUTION",
      type: "invalid_data",
      message: `attribution rule ${ruleId ?? "(none)"} not active/unknown`,
      customerMessage:
        "Không thêm được sản phẩm này. Bạn tải lại trang giúp nhé!",
    }),
  productInactive: () =>
    new BusinessError({
      code: "SUGGESTION_PRODUCT_INACTIVE",
      type: "invalid_data",
      message: "product/variant not active or unpublished",
      customerMessage: "Sản phẩm này hiện không còn bán.",
    }),
} as const;

export const AdminErrors = {
  rulePriorityConflict: (conflictingRuleId: string) =>
    new BusinessError({
      code: "RULE_PRIORITY_CONFLICT",
      type: "conflict",
      message: `(type,tier,priority) already used by rule ${conflictingRuleId}`,
      customerMessage:
        "Trùng độ ưu tiên (type/tier/priority) với một rule khác.",
      details: { conflicting_rule_id: conflictingRuleId },
    }),
  complementPairDuplicate: () =>
    new BusinessError({
      code: "COMPLEMENT_PAIR_DUPLICATE",
      type: "conflict",
      message: "(source_category, complement_category) pair already exists",
      customerMessage: "Cặp category bổ trợ này đã tồn tại.",
    }),
} as const;

export const CartErrors = {
  notFound: (cartId: string) =>
    new BusinessError({
      code: "CART_NOT_FOUND",
      type: "not_found",
      message: `cart ${cartId} not found`,
      customerMessage: "Không tìm thấy giỏ hàng. Bạn tải lại trang nhé!",
    }),
} as const;

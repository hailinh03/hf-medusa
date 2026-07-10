/**
 * Standardized business errors - API_CONTRACT section 3 / SPEC C.1.
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
    message: string; // Internal message for logs.
    customerMessage: string; // Safe customer-facing message.
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
 * Error code catalog (API_CONTRACT sections 4 and 5).
 * paired with their Vietnamese customer message. Helpers below build the error.
 */
export const SuggestionErrors = {
  stockConflict: (product: string, productId?: string) =>
    new BusinessError({
      code: "SUGGESTION_STOCK_CONFLICT",
      type: "conflict",
      message: `variant out of stock at execution for product ${productId ?? product}`,
      customerMessage: `${product} just went out of stock. We updated your suggestions.`,
      details: productId ? { product_id: productId } : undefined,
    }),
  variantSelectionRequired: (variants: unknown[]) =>
    new BusinessError({
      code: "SUGGESTION_VARIANT_SELECTION_REQUIRED",
      type: "invalid_data",
      message: "A variant must be selected for this product",
      customerMessage: "Please select a product variant.",
      details: { variants },
    }),
  invalidAttribution: (ruleId?: string) =>
    new BusinessError({
      code: "SUGGESTION_INVALID_ATTRIBUTION",
      type: "invalid_data",
      message: `attribution rule ${ruleId ?? "(none)"} not active/unknown`,
      customerMessage: "This product could not be added. Please refresh the page and try again.",
    }),
  productInactive: () =>
    new BusinessError({
      code: "SUGGESTION_PRODUCT_INACTIVE",
      type: "invalid_data",
      message: "product/variant not active or unpublished",
      customerMessage: "This product is no longer available.",
    }),
} as const;

export const AdminErrors = {
  rulePriorityConflict: (conflictingRule: { id: string; name: string }) =>
    new BusinessError({
      code: "RULE_PRIORITY_CONFLICT",
      type: "conflict",
      message: `(type,tier,priority) already used by rule ${conflictingRule.id} (${conflictingRule.name})`,
      customerMessage: `This priority is already used by rule "${conflictingRule.name}".`,
      details: {
        conflicting_rule_id: conflictingRule.id,
        conflicting_rule_name: conflictingRule.name,
      },
    }),
  complementPairDuplicate: () =>
    new BusinessError({
      code: "COMPLEMENT_PAIR_DUPLICATE",
      type: "conflict",
      message: "(source_category, complement_category) pair already exists",
      customerMessage: "This category complement pair already exists.",
    }),
} as const;

export const CartErrors = {
  notFound: (cartId: string) =>
    new BusinessError({
      code: "CART_NOT_FOUND",
      type: "not_found",
      message: `cart ${cartId} not found`,
      customerMessage: "The cart was not found. Please refresh the page.",
    }),
} as const;

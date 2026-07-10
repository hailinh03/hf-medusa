import {
  defineMiddlewares,
  validateAndTransformBody,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { BusinessError, ErrorType } from "../lib/errors";
import {
  CreateSuggestionRuleSchema,
  UpdateSuggestionRuleSchema,
} from "./admin/suggestion-rules/validators";

/**
 * Standardized error envelope — API_CONTRACT §3 / SPEC C.1.
 * Serializes BusinessError (and maps native MedusaError) into:
 *   { type, code, message, customer_message, details, request_id }
 * Overrides Medusa's default (invalid_data → 400) so business validation
 * returns 422 and rate-limits return 429.
 */
function toEnvelope(err: any): {
  status: number;
  body: {
    type: ErrorType;
    code: string;
    message: string;
    customer_message: string;
    details?: Record<string, unknown>;
  };
} {
  if (err instanceof BusinessError) {
    return {
      status: err.httpStatus,
      body: {
        type: err.type,
        code: err.code,
        message: err.message,
        customer_message: err.customerMessage,
        details: err.details,
      },
    };
  }

  // Map native MedusaError types → our envelope.
  if (err instanceof MedusaError) {
    const map: Record<string, { status: number; type: ErrorType; cm: string }> =
      {
        [MedusaError.Types.NOT_FOUND]: {
          status: 404,
          type: "not_found",
          cm: "Không tìm thấy dữ liệu yêu cầu.",
        },
        [MedusaError.Types.NOT_ALLOWED]: {
          status: 403,
          type: "not_allowed",
          cm: "Bạn không có quyền thực hiện.",
        },
        [MedusaError.Types.UNAUTHORIZED]: {
          status: 401,
          type: "unauthorized",
          cm: "Bạn cần đăng nhập để tiếp tục.",
        },
        [MedusaError.Types.INVALID_DATA]: {
          status: 422,
          type: "invalid_data",
          cm: "Dữ liệu không hợp lệ.",
        },
        [MedusaError.Types.DUPLICATE_ERROR]: {
          status: 409,
          type: "conflict",
          cm: "Dữ liệu đã tồn tại.",
        },
        [MedusaError.Types.CONFLICT]: {
          status: 409,
          type: "conflict",
          cm: "Có xung đột dữ liệu, bạn thử lại nhé.",
        },
      };
    const m = map[err.type] ?? {
      status: 400,
      type: "invalid_data" as ErrorType,
      cm: "Yêu cầu không hợp lệ.",
    };
    return {
      status: m.status,
      body: {
        type: m.type,
        code: err.type?.toUpperCase() ?? "INVALID_DATA",
        message: err.message,
        customer_message: m.cm,
      },
    };
  }

  // Unknown → 500 generic (never leak internals to customer).
  return {
    status: 500,
    body: {
      type: "server_error",
      code: "INTERNAL_ERROR",
      message: err?.message ?? "unknown error",
      customer_message: "Có lỗi xảy ra, bạn thử lại sau ít phút nhé!",
    },
  };
}

const errorHandler = (
  err: any,
  req: MedusaRequest,
  res: MedusaResponse,
  _next: any,
) => {
  const { status, body } = toEnvelope(err);
  if (status >= 500) {
    const logger = req.scope?.resolve?.("logger");
    logger?.error?.(
      `[api] ${req.method} ${req.originalUrl} → ${body.code}: ${body.message}`,
    );
  }
  res.status(status).json({ ...body, request_id: (req as any).requestId });
};

/**
 * API middlewares (SRS §6.1) + standardized error handling (API_CONTRACT §3).
 */
export default defineMiddlewares({
  errorHandler,
  routes: [
    {
      matcher: "/admin/suggestion-rules",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateSuggestionRuleSchema)],
    },
    {
      matcher: "/admin/suggestion-rules/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(UpdateSuggestionRuleSchema)],
    },
  ],
});

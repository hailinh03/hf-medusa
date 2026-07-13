import {
  defineMiddlewares,
  validateAndTransformBody,
} from "@medusajs/framework/http";
import {
  CreateSuggestionRuleSchema,
  UpdateSuggestionRuleSchema,
} from "./admin/suggestion-rules/validators";
import {
  ApplyVoucherSchema,
  RemoveVoucherSchema,
} from "./store/cart/voucher/validators";

/**
 * API middlewares. Body validation for admin suggestion-rule writes (SRS §6.1)
 * and store voucher writes (SPEC §23.5, tasks 3.8.3/3.8.4): validateAndTransformBody
 * parses with the zod schema and sets req.validatedBody.
 *
 * NOTE: `/store/cart/voucher` route handlers (route.ts) are not implemented in
 * this session — they depend on `applyVoucherWorkflow`/`removeVoucherWorkflow`,
 * which are out of scope (see .claude/progress/voucher-engine-progress.md).
 * This entry only wires the strict validators ahead of that route landing;
 * `defineMiddlewares` is a declarative matcher config and does not require a
 * matching route to exist, so this is inert until route.ts is added.
 */
export default defineMiddlewares({
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
    {
      matcher: "/store/cart/voucher",
      method: "POST",
      middlewares: [validateAndTransformBody(ApplyVoucherSchema)],
    },
    {
      matcher: "/store/cart/voucher",
      method: "DELETE",
      middlewares: [validateAndTransformBody(RemoveVoucherSchema)],
    },
  ],
});

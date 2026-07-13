# VoucherEngine Diagram Index

These diagrams are part of the VoucherEngine Solution Flow Document for RallyGear.

## Diagram Files

| ID | File | Purpose |
|---|---|---|
| D-01 | `d01-voucher-module-interaction.md` | Shows VoucherEngine module boundaries and integration points. |
| D-02 | `d02-apply-voucher-sequence.md` | Shows the end-to-end apply voucher sequence. |
| D-03 | `d03-voucher-validation-flow.md` | Shows fail-fast validation V1–V8. |
| D-04 | `d04-discount-resolution-flow.md` | Shows promotion-first, voucher-second, global-cap calculation. |
| D-05 | `d05-cart-change-revalidation-sequence.md` | Shows revalidation after cart updates. |
| D-06 | `d06-voucher-usage-recording-sequence.md` | Shows usage recording after successful order placement. |
| D-07 | `d07-conceptual-voucher-domain-relationship.md` | Shows conceptual domain relationships. |

## Usage Rule

Claude Code must read these diagrams together with `voucher-engine.solution-flow.md` before generating `SPEC.md`.

The diagrams are solution-level. They must not be treated as source-code design, file paths, class names, or implementation-specific method names.

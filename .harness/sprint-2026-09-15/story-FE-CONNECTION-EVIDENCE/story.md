# FE-CONNECTION-EVIDENCE — In Progress
Authorization: user handoff and exclusive FE scope, 2026-09-15. No commits/merges.
AC1: Direct start forwards selected providerId as connection_id; preserve cwd/mode/step.
AC2: Only node_done with provider_verified === true and a concrete connection_id verifies; no node_start/adapter/composer fallback. Structured authentication/transport node_error faults only its connection. Disabled/probing connections and superseded streams remain protected.
AC3: Refresh usage after terminal completion, error or stream close independently of verification; retain node_error tokens.
AC4: Honest usage labels: unknown != free; identify estimates and unavailable measurement breakdown; expose loading/error states. Reject nonfinite/negative budget locally. Preserve backend schema until coordinated.
DoD: RED/GREEN per seam, scoped + full FE tests, typecheck, Hallmark audit; independent QA/ARCH/SEC and live BE integration pending separately.

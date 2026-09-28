# Ledger — DOSSIER-CRED-LENGTH

## 2026-09-18 02:45 START (claude)
- RED já existia: Dossier.test.tsx "does not invent a key length for a credential reference
  restored from backend" — 1 failed na suíte inteira (347 passed / 1 failed antes do fix).
- Causa raiz (AC#2): componente, não o teste. `CredentialSeal.tsx` renderizava `${s.length} characters`
  e `<Redaction length={s.length - prefix - 4}>` mesmo com `length: 0` (referência restaurada do
  backend, `vault: "backend"`, sem metadados) → "0 characters" e barra de largura negativa = medida
  inventada. O teste estava certo.
- Fix: `Redaction` aceita `length: null` → aria-label "Credential value withheld; length unavailable",
  largura fixa; linha "length" vira "not reported by the vault" quando `length` não é > 0.
- GREEN (saída real): `npx vitest run --run` → 67 files, 348 passed / 0 failed; `tsc --noEmit` limpo.
  Asserção do teste intacta (AC#1). Exit: "Ready for QA" (QA fresh-context após reset 20/09).

# Story DOSSIER-CRED-LENGTH — Corrigir o teste de credential-length do Dossier

Dono: **Claude** (FE). Única falha do Vitest:
`frontend/src/components/providers/Dossier.test.tsx` — "does not invent a key length for a credential reference restored from backend".

As a usuário vendo a página Providers,
I want que uma credencial restaurada do backend não mostre um comprimento de chave inventado,
So that a UI não afirme algo que não mediu.

## Acceptance Criteria
1. O teste existente passa sem afrouxar sua asserção.
2. Se a causa for no componente, o Dossier mostra "referência" em vez de comprimento; se for no
   teste, o ledger explica por que o teste estava errado antes de mudá-lo.

## Testing seams
- AC#1 → `Dossier.test.tsx` → unit
- AC#2 → ledger

## Definition of Done
- [ ] Vitest 317/317 (saída real); ledger registra causa raiz
- [ ] PO accepted in Sprint Review

## Story Points
1

## Priority
P2

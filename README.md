# travel-guide
An open-source travel planner that helps users compare flights, hotels, attractions and build optimized itineraries.

## Desenvolvimento

Requisitos: Node 20+ e um projeto [Supabase](https://supabase.com).

1. `npm install`
2. `cp apps/web/.env.example apps/web/.env.local` e preencha as variáveis.
3. Aplique `supabase/migrations/*.sql` ao projeto (SQL Editor ou Supabase CLI), primeiro em ambiente de testes.
4. No Supabase Auth, habilite e-mail (link mágico) e Google, e cadastre `http://localhost:3000/auth/callback` como redirect URL.
5. `npm run dev:web` e abra http://localhost:3000.

Comandos: `npm run typecheck`, `npm test -w @travel-guide/web`, `npm run lint -w @travel-guide/web`.

Escopo e fases: [`docs/mvp-spec.md`](docs/mvp-spec.md).

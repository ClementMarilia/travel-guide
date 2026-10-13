# travel-guide
An open-source travel planner that helps users compare flights, hotels, attractions and build optimized itineraries.

## Publicação e configuração (tudo online)

O projeto roda inteiramente na nuvem: código no GitHub, banco e autenticação no Supabase, aplicação na Vercel. Nada precisa ser instalado ou executado localmente, e nenhuma credencial fica no código.

1. **Supabase:** crie o projeto e aplique `supabase/migrations/*.sql` pelo SQL Editor (ou pela integração GitHub do Supabase). Em Authentication, habilite e-mail (link mágico) e Google.
2. **Vercel:** importe este repositório com *Root Directory* `apps/web`.
3. **Variáveis de ambiente** (Vercel → Settings → Environment Variables; nunca no código ou no Git):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave publicável, protegida pelas políticas RLS.
   - `OPENAI_API_KEY` e `OPENAI_MODEL` (opcionais, só no servidor; nunca com prefixo `NEXT_PUBLIC_`).
4. **URLs de retorno:** no Supabase (Authentication → URL Configuration), cadastre o domínio da Vercel e `https://<dominio>/auth/callback`. As chaves do Google ficam no painel do Supabase.
5. Cada push na branch gera um *preview deploy* na Vercel; a validação (`typecheck`, testes, build) roda lá.

`apps/web/.env.example` apenas lista os nomes das variáveis, sem valores. Chaves `service_role` e demais segredos não devem ser usados no frontend nem commitados.

Escopo e fases: [`docs/mvp-spec.md`](docs/mvp-spec.md).

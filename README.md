# travel-guide

An open-source travel planner that helps users compare flights, hotels, attractions and build optimized itineraries.

## Publicação e configuração (tudo online)

O projeto roda inteiramente na nuvem: código no GitHub, banco e autenticação no Supabase, aplicação na Vercel. Nada precisa ser instalado ou executado localmente, e nenhuma credencial fica no código.

1. **Supabase:** crie o projeto e aplique, em ordem, `supabase/migrations/*.sql` pelo SQL Editor (ou pela integração GitHub do Supabase). Em Authentication, habilite e-mail (link mágico) e Google.
2. **Vercel:** importe este repositório com _Root Directory_ `apps/web`.
3. **Variáveis de ambiente** (Vercel → Settings → Environment Variables; nunca no código ou no Git):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave publicável, protegida pelas políticas RLS.
   - `GEMINI_API_KEY` e `GEMINI_MODEL` (opcional, padrão `gemini-3.8-flash`, o modelo recomendado): ativam o chat. Cada pessoa pode escolher outro modelo em **Perfil → Integrações de IA**; a lista vem da própria API do Gemini. Só no servidor; nunca com prefixo `NEXT_PUBLIC_`. A chave é criada no Google AI Studio.
4. **URLs de retorno:** no Supabase (Authentication → URL Configuration), cadastre o domínio da Vercel e `https://<dominio>/auth/callback`. As chaves do Google ficam no painel do Supabase.
5. Cada push na branch gera um _preview deploy_ na Vercel; a validação (`typecheck`, testes, build) roda lá.

`apps/web/.env.example` apenas lista os nomes das variáveis, sem valores. Chaves `service_role` e demais segredos não devem ser usados no frontend nem commitados.

Escopo e fases: [`docs/mvp-spec.md`](docs/mvp-spec.md).

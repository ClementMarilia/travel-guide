# Testes

Os testes ficam em `apps/api/test` e usam apenas o executor embutido do Node (`node:test`) com `tsx`. Não há dependências de teste a mais.

```bash
npm test                    # na raiz: roda os testes da API
npm run test:unit -w @travel-guide/api
```

## Duas camadas

**Unitários** (`test/unit`, sem banco): as regras de domínio.
- ordem das etapas e regra de preço (`resolvePrice`);
- criptografia da chave de IA;
- leitura de preço e horário no texto de páginas (`1.234,50 EUR`, `9h` sem confundir com `19h`);
- bloqueio de endereços internos ao baixar páginas (SSRF), incluindo redirecionamentos;
- ligação de fatos às fontes (deslocamentos em bytes, "não encontrado" nunca com fonte);
- orçamento (unidades, moeda, riscos, adulteração), dias (limite, duplicados, horários), restrições, base, rota e verificação.

**Integração** (`test/integration`, exige Postgres): a API Express completa, com o Gemini e os sites de preço simulados por servidores locais (`test/helpers/fake-servers.ts`). Nenhum teste acessa a internet nem usa uma chave real.
- autenticação, posse dos dados (outro usuário recebe 404), viagens, viajantes e configuração da IA;
- o fluxo inteiro, da entrevista à verificação, com as travas de cada etapa.

## Rodando a integração

Defina `TEST_DATABASE_URL` apontando para um banco de teste **vazio ou descartável** (os testes criam usuários e viagens) e aplique as migrações:

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/travel_guide_test
export DATABASE_URL=$TEST_DATABASE_URL
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma   # ou, em apps/api: npx prisma migrate deploy
npm test
```

Sem `TEST_DATABASE_URL`, os testes de integração aparecem como pulados e só os unitários rodam.

## O que os testes não provam

Eles usam um Gemini simulado: garantem que **o servidor** aplica as regras (fontes, preços, limites, ordem), mas não a qualidade das respostas de um modelo real. Isso só se vê com uma chave real.

## CI

`.github/workflows/ci.yml` roda `typecheck` e `npm test` a cada push na `main` e em pull requests, com um Postgres como serviço.

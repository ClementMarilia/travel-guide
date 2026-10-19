# Travel Studio AI — Contrato de produto (19/10/2026)

## Objetivo
Planejar viagens rápidas no celular ou navegador. Na entrada o viajante informa origem, destino, período, número de viajantes, meio de transporte preferido e teto de orçamento. O plano deve seguir as sete etapas e preservar aprovações.

## Experiência
- Visual premium, responsivo, fluido, acessível e com componentes reutilizáveis.
- Landing com formulário direto e persistência de viagem em conta autenticada.
- Dashboard e estúdio existentes são reutilizados; evitar recriar o produto em outro repositório.
- Orçamento total visível e identificado como teto fornecido pelo usuário, não como preço pesquisado.
- Comparações de viagem devem separar preço confirmado, estimativa, indisponível e fonte/data.

## Pesquisa de transporte e hospedagem
Provedores mencionados pelo produto: Google Flights/Google Travel, Momondo, Trip.com e equivalentes.
- Referências a esses provedores são **fontes-alvo**, não integrações existentes.
- Não usar scraping contrário aos termos, contornar bloqueios ou apresentar estimativas de IA como tarifas reais.
- Integrações devem ocorrer somente via APIs licenciadas/autorizadas, dentro de cotas gratuitas confirmadas, ou fontes públicas permitidas.
- Na ausência de integração disponível: apresentar "não verificado" e permitir planejamento manual, sem inventar preços.
- Não incluir imagens externas, hotlinks, embeds externos ou links de reserva no site. Usar CSS, SVG próprio ou recursos estáticos internos com licenças apropriadas.
- A pesquisa, se habilitada futuramente, pode consultar APIs externas autorizadas **para dados**, sem carregar recursos visuais nem redirecionar para reservas. Se a restrição "nenhum recurso externo" incluir até APIs de dados, será necessário remover integrações ao vivo e usar somente dados internos — não é possível consultar preços reais de portais externos de outra forma.

## Custo e segurança
- Não ativar recursos pagos, serviços faturáveis ou chamadas automáticas de consumo não controlado.
- Nenhum segredo no navegador; autorização no backend; RLS no banco.
- Publicação via GitHub e Vercel; dados no Supabase.
- Todas as alterações passam por PR e quality gate; produção protegida.

## Estado desta entrega
Apenas entrada rápida e novo visual da página inicial. Ainda falta comprovação de build, funcionamento em preview autenticado, integrações comerciais de pesquisa, roteiro completo e testes mobile.

-- Modelo de IA escolhido por cada pessoa (nulo = usar o recomendado pelo sistema).
alter table profiles
  add column ai_model text
  check (ai_model is null or ai_model ~ '^[A-Za-z0-9._-]{1,64}$');

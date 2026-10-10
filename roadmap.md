# Roadmap — Falcon Serviços Ronda

## Em andamento
- [ ] 1. Logo "Falcon Serviços" no cabeçalho (usar imagem enviada, adaptar para fundo escuro do header)
- [ ] 2. Mensagem de boas-vindas acolhedora na tela de identificação (antes do nome)
- [x] 3. Leitor de QR: limpar URL/maiúsculas e buscar pelo código limpo (normalizarCodigoQr) — FEITO, falta validar
- [ ] 4. Modo Administrador (apenas ex: Mauro) pode excluir registros; seguranças só registram/visualizam
- [ ] 5. Histórico: filtros por intervalo de datas (inicial/final) + botão "Imprimir / Gerar Relatório" (PDF/papel limpo)

## Feito
- normalizarCodigoQr em src/lib/rondas.ts (extrai PRD01-EXT-01 de URLs, barras, minúsculas)

import base64
import io
import qrcode

# Locais cadastrados no Supabase
locais = [
    {"nome": "Portaria Central - Samambaia", "hash": "samambaia-01"},
    {"nome": "Área Externa - Água Nativa", "hash": "aguanativa-01"},
    {"nome": "Portaria e Perímetro - Dream Park", "hash": "dreampark-01"},
    {"nome": "Santuário / Base - Divino Pai Eterno", "hash": "divinopaieterno-01"},
    {"nome": "Posto Principal - Boi Forte", "hash": "boiforte-01"},
    {"nome": "Área Comercial - Donaldo", "hash": "donaldo-01"},
    {"nome": "Setor Operacional - Banana Menina", "hash": "bananamenina-01"},
    {"nome": "Posto de Controle - OM", "hash": "om-01"},
    {"nome": "Posto Principal - Santo Antônio", "hash": "santoantonio-01"},
    {"nome": "Instalações - Stival", "hash": "stival-01"},
]

html_content = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>QR Codes - Falcon Serviços</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .card { background: white; border: 2px solid #333; border-radius: 8px; padding: 20px; text-align: center; page-break-inside: avoid; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h2 { margin: 5px 0; font-size: 18px; color: #111; }
        p { margin: 5px 0 15px 0; font-size: 14px; color: #555; font-weight: bold; }
        img { width: 180px; height: 180px; }
    </style>
</head>
<body>
    <h1 style="text-align: center; color: #222; margin-bottom: 30px;">Falcon Serviços - QR Codes para Testes</h1>
    <div class="grid">
"""

for local in locais:
  # Link oficial direcionando para a app na Vercel com o hash respetivo
  url = f"https://falcon-servicos.vercel.app/?qr={local['hash']}"

  # Gerar QR code em memória
  qr = qrcode.QRCode(box_size=10, border=2)
  qr.add_data(url)
  qr.make(fit=True)
  img = qr.make_image(fill_color="black", back_color="white")

  buffered = io.BytesIO()
  img.save(buffered, format="PNG")
  img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

  html_content += f"""
        <div class="card">
            <h2>{local['nome']}</h2>
            <p>Hash: {local['hash']}</p>
            <img src="data:image/png;base64,{img_str}" alt="QR Code">
        </div>
"""

html_content += """
    </div>
</body>
</html>
"""

with open("qrcodes_rondas.html", "w", encoding="utf-8") as f:
  f.write(html_content)

print(
    "Sucesso! O ficheiro 'qrcodes_rondas.html' foi gerado na pasta do projeto."
)
import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { 
  LocalRonda, 
  buscarLocalPorQr, 
  registrarRonda, 
  normalizarCodigoQr 
} from '@/lib/rondas';

interface Props {
  segurançaNome: string;
}

export function PainelRondassegurança({ segurançaNome }: Props) {
  const [locais, setLocais] = useState<LocalRonda[]>([]);
  const [rondasHoje, setRondasHoje] = useState<any[]>([]);
  const [codigoInput, setCodigoInput] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Modal de anomalia
  const [localAnomalia, setLocalAnomalia] = useState<LocalRonda | null>(null);
  const [descricaoAnomalia, setDescricaoAnomalia] = useState('');
  const [gravidade, setGravidade] = useState<'MODERADA' | 'GRAVE'>('MODERADA');

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    try {
      setCarregando(true);
      // 1. Busca todos os locais cadastrados
      const { data: locaisData, error: errLocais } = await supabase
        .from('locais_ronda')
        .select('*');
      if (errLocais) throw errLocais;
      setLocais(locaisData || []);

      // 2. Busca as rondas feitas hoje para calcular as pendências
      const hojeInicio = new Date();
      hojeInicio.setHours(0, 0, 0, 0);

      const { data: rondasData, error: errRondas } = await supabase
        .from('registros_rondas')
        .select('local_id, status, created_at')
        .gte('created_at', hojeInicio.toISOString());

      if (errRondas) throw errRondas;
      setRondasHoje(rondasData || []);
    } catch (err: any) {
      setErro('Erro ao carregar dados do plantão: ' + err.message);
    } finally {
      setCarregando(false);
    }
  }

  // IDs dos locais que já receberam baixa hoje
  const locaisVisitadosIds = new Set(rondasHoje.map(r => r.local_id));
  const locaisPendentes = locais.filter(l => !locaisVisitadosIds.has(l.id));

  // Simular ou processar a leitura do QR Code
  async function handleValidarQr(codigoLido: string) {
    if (!codigoLido.trim()) return;
    setErro(null);
    setSucesso(null);

    try {
      const local = await buscarLocalPorQr(codigoLido);
      if (!local) {
        setErro(`QR Code não reconhecido: "${codigoLido}". Verifique o posto.`);
        return;
      }

      // Verifica se já foi visitado hoje
      if (locaisVisitadosIds.has(local.id)) {
        setErro(`O posto "${local.local}" (${local.predio}) já foi registado hoje!`);
        return;
      }

      // Regista como OK por padrão na leitura direta do QR
      await registrarRonda({
        localId: local.id,
        segurança: segurançaNome,
        status: 'OK'
      });

      setSucesso(`Check-in realizado com sucesso em: ${local.local} (${local.predio})!`);
      setCodigoInput('');
      carregarDados(); // Atualiza a lista em tempo real
    } catch (err: any) {
      setErro('Erro ao registar ronda: ' + err.message);
    }
  }

  async function handleSalvarAnomalia() {
    if (!localAnomalia) return;
    try {
      await registrarRonda({
        localId: localAnomalia.id,
        segurança: segurançaNome,
        status: 'ANOMALIA',
        gravidade: gravidade,
        descricao: descricaoAnomalia || 'Anomalia detetada na ronda.'
      });

      setSucesso(`Anomalia reportada com sucesso para ${localAnomalia.local}!`);
      setLocalAnomalia(null);
      setDescricaoAnomalia('');
      carregarDados();
    } catch (err: any) {
      setErro('Erro ao reportar anomalia: ' + err.message);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Ronda de Plantão</h2>
            <p className="text-sm text-gray-500">segurança: <span className="font-semibold text-gray-700">{segurançaNome}</span></p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-emerald-600">{locais.length - locaisPendentes.length}</span>
            <span className="text-gray-400 text-sm"> / {locais.length} postos</span>
            <p className="text-xs text-gray-500">Concluídos hoje</p>
          </div>
        </div>

        {/* Campo de input simulando a leitura do QR Code pela câmara */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Registar via Leitor de QR Code:</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Aponte o leitor ou digite o código (Ex: B10-SUP-15)"
              value={codigoInput}
              onChange={(e) => setCodigoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleValidarQr(codigoInput)}
              className="flex-1 border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <button
              onClick={() => handleValidarQr(codigoInput)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition"
            >
              Validar QR
            </button>
          </div>
        </div>

        {erro && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{erro}</div>}
        {sucesso && <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">{sucesso}</div>}
      </div>

      {/* Lista de Locais Pendentes */}
      <div className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
        <h3 className="font-bold text-gray-800 text-lg">Postos Pendentes no Turno ({locaisPendentes.length})</h3>
        
        {carregando ? (
          <p className="text-sm text-gray-500 text-center py-4">A carregar postos...</p>
        ​) : locaisPendentes.length === 0 ? (
          <div className="p-6 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-center font-medium">
            🎉 Parabéns! Todos os postos obrigatórios deste plantão já foram visitados!
          </div>
        ) : (
          <div className="space-y-3">
            {locaisPendentes.map((local) => (
              <div key={local.id} className="flex items-center justify-between p-4 border rounded-xl bg-gray-50 hover:bg-gray-100 transition">
                <div>
                  <h4 className="font-bold text-gray-900">{local.local}</h4>
                  <p className="text-xs text-gray-500">{local.predio} • Hash: <span className="font-mono text-gray-700">{local.qr_code_hash}</span></p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleValidarQr(local.qr_code_hash)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    Simular Check-in
                  </button>
                  <button
                    onClick={() => setLocalAnomalia(local)}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    Anomalia
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Registo de Anomalia */}
      {localAnomalia && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Reportar Anomalia</h3>
            <p className="text-sm text-gray-600">Posto: <span className="font-semibold">{localAnomalia.local}</span></p>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-700">Gravidade do Problema:</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGravidade('MODERADA')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border ${gravidade === 'MODERADA' ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-50 text-gray-700'}`}
                >
                  Moderada
                </button>
                <button
                  type="button"
                  onClick={() => setGravidade('GRAVE')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border ${gravidade === 'GRAVE' ? 'bg-red-600 text-white border-red-600' : 'bg-gray-50 text-gray-700'}`}
                >
                  Grave (Requer Correção)
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Descrição do Problema:</label>
              <textarea
                rows={3}
                placeholder="Ex: Extintor obstruído, mangueira danificada..."
                value={descricaoAnomalia}
                onChange={(e) => setDescricaoAnomalia(e.target.value)}
                className="w-full border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setLocalAnomalia(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-lg text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleSalvarAnomalia}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-semibold"
              >
                Enviar Alerta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
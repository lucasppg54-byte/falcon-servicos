import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QrCodeImage } from "@/components/QrCodeImage";
import { gerarHashLocal, montarConteudoQr, obterUrlPublica } from "@/lib/locais-qr";
import { abrirFolhaQrCodes, baixarQrPng, type ColunasImpressao } from "@/lib/qrcodes";
import type { LocalRonda } from "@/lib/rondas";

const CAMPO =
  "w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500";

export function LocaisQrSection({
  locais,
  onAlterado,
}: {
  locais: LocalRonda[];
  onAlterado: () => void;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [predio, setPredio] = useState("");
  const [localNome, setLocalNome] = useState("");
  const [qrHash, setQrHash] = useState("");
  const [hashManual, setHashManual] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [filtroPredio, setFiltroPredio] = useState("TODOS");
  const [busca, setBusca] = useState("");
  const [colunas, setColunas] = useState<ColunasImpressao>(3);
  const [qrAbertoId, setQrAbertoId] = useState<string | null>(null);
  const [gerandoLote, setGerandoLote] = useState(false);

  const predios = useMemo(
    () => Array.from(new Set(locais.map((l) => l.predio).filter(Boolean))).sort(),
    [locais],
  );

  const hashesOutros = useMemo(
    () => locais.filter((l) => l.id !== editandoId).map((l) => l.qr_code_hash),
    [locais, editandoId],
  );

  const locaisVisiveis = locais.filter((l) => {
    if (filtroPredio !== "TODOS" && l.predio !== filtroPredio) return false;
    const termo = busca.trim().toLowerCase();
    if (!termo) return true;
    return [l.predio, l.local, l.qr_code_hash].some((v) => v.toLowerCase().includes(termo));
  });

  function atualizarPredio(valor: string) {
    setPredio(valor);
    // Em novos locais o hash acompanha o prédio até o admin o editar manualmente.
    if (!editandoId && !hashManual)
      setQrHash(valor.trim() ? gerarHashLocal(valor, hashesOutros) : "");
  }

  function regenerarHash() {
    if (!predio.trim()) {
      window.alert("Indique primeiro o nome do posto / prédio.");
      return;
    }
    setQrHash(gerarHashLocal(predio, hashesOutros));
    setHashManual(false);
  }

  function prepararEdicao(loc: LocalRonda) {
    setEditandoId(loc.id);
    setPredio(loc.predio);
    setLocalNome(loc.local);
    setQrHash(loc.qr_code_hash);
    setHashManual(true);
    document
      .getElementById("form-local-ronda")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function limparFormulario() {
    setEditandoId(null);
    setPredio("");
    setLocalNome("");
    setQrHash("");
    setHashManual(false);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const hash = qrHash.trim().toLowerCase();
    if (!predio.trim() || !localNome.trim() || !hash) {
      window.alert("Preencha todos os campos do local de ronda.");
      return;
    }
    if (hashesOutros.some((h) => h.toLowerCase() === hash)) {
      window.alert(`Já existe um local com o código "${hash}". Gere outro código.`);
      return;
    }
    const original = locais.find((l) => l.id === editandoId);
    if (
      original &&
      original.qr_code_hash.toLowerCase() !== hash &&
      !window.confirm("Alterar o código invalida o QR já impresso deste local. Continuar?")
    ) {
      return;
    }

    setSalvando(true);
    try {
      const dados = { predio: predio.trim(), local: localNome.trim(), qr_code_hash: hash };
      const { error } = editandoId
        ? await supabase.from("locais_ronda").update(dados).eq("id", editandoId)
        : await supabase.from("locais_ronda").insert([dados]);
      if (error) throw error;

      window.alert(
        editandoId
          ? "Local atualizado com sucesso!"
          : "Local cadastrado com sucesso! O QR code já está disponível.",
      );
      limparFormulario();
      onAlterado();
    } catch (err) {
      window.alert((err as { message?: string } | null)?.message || "Erro ao salvar local.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    if (!window.confirm("Deseja excluir este local de ronda?")) return;
    try {
      const { error } = await supabase.from("locais_ronda").delete().eq("id", id);
      if (error) throw error;
      if (editandoId === id) limparFormulario();
      onAlterado();
    } catch {
      window.alert("Erro ao excluir local.");
    }
  }

  async function imprimirLote() {
    setGerandoLote(true);
    try {
      await abrirFolhaQrCodes(locaisVisiveis, colunas);
    } catch {
      window.alert("Não foi possível gerar a folha de QR codes.");
    } finally {
      setGerandoLote(false);
    }
  }

  return (
    <div className="space-y-5 rounded-[18px] bg-zinc-900 p-4 shadow-xl ring-1 ring-zinc-800 sm:p-6">
      {/* ---------- Formulário ---------- */}
      <div id="form-local-ronda" className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[16px] font-bold text-zinc-100">
          {editandoId ? "✏️ Editar Local de Ronda" : "📍 Cadastrar Novo Local de Ronda"}
        </h4>
        {editandoId && (
          <button
            onClick={limparFormulario}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300"
          >
            Cancelar Edição
          </button>
        )}
      </div>

      <form onSubmit={salvar} className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-zinc-400">
              Nome do Posto / Prédio
            </label>
            <input
              type="text"
              list="lista-predios"
              value={predio}
              onChange={(e) => atualizarPredio(e.target.value)}
              placeholder="Ex.: Samambaia"
              className={CAMPO}
            />
            <datalist id="lista-predios">
              {predios.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-zinc-400">
              Descrição do Local
            </label>
            <input
              type="text"
              value={localNome}
              onChange={(e) => setLocalNome(e.target.value)}
              placeholder="Ex.: Portaria Central"
              className={CAMPO}
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-[12px] font-semibold text-zinc-400">
              Código QR (gerado automaticamente)
              {!hashManual && qrHash && (
                <span className="text-[11px] font-medium text-emerald-400">auto</span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={qrHash}
                onChange={(e) => {
                  setQrHash(e.target.value);
                  setHashManual(true);
                }}
                placeholder="Preenchido ao indicar o prédio"
                className={`${CAMPO} min-w-0 flex-1 font-mono`}
              />
              <button
                type="button"
                onClick={regenerarHash}
                title="Gerar novo código"
                className="shrink-0 rounded-xl bg-zinc-800 px-3 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-700"
              >
                ↻ Gerar
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={salvando}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3.5 font-display text-[15px] font-bold text-zinc-950 shadow-md disabled:opacity-60 active:translate-y-0.5"
          >
            {salvando
              ? "A guardar..."
              : editandoId
                ? "Salvar Alterações do Local"
                : "+ Adicionar Local e Gerar QR"}
          </button>
        </div>

        <div
          className={`${qrHash.trim() ? "flex" : "hidden md:flex"} flex-col items-center justify-center gap-2 rounded-xl bg-zinc-950 p-4 ring-1 ring-zinc-800`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Pré-visualização
          </span>
          {qrHash.trim() ? (
            <QrCodeImage conteudo={montarConteudoQr(qrHash)} tamanho={150} />
          ) : (
            <div className="grid size-[150px] place-items-center rounded-lg border-2 border-dashed border-zinc-700 text-center text-[11px] text-zinc-500">
              O QR aparece aqui
            </div>
          )}
          <span className="max-w-[180px] break-all text-center font-mono text-[11px] text-zinc-400">
            {qrHash.trim().toLowerCase() || "—"}
          </span>
        </div>
      </form>

      {/* ---------- Lista + impressão em lote ---------- */}
      <div className="space-y-3 border-t border-zinc-800 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-zinc-300">
            Locais Cadastrados ({locaisVisiveis.length}
            {locaisVisiveis.length !== locais.length ? ` de ${locais.length}` : ""})
          </p>
          <span className="text-[11px] text-zinc-500">QR aponta para {obterUrlPublica()}</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
          <select
            value={filtroPredio}
            onChange={(e) => setFiltroPredio(e.target.value)}
            className={CAMPO}
          >
            <option value="TODOS">🏢 Todos os postos</option>
            {predios.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍 Procurar local ou código"
            className={CAMPO}
          />
          <select
            value={colunas}
            onChange={(e) => setColunas(Number(e.target.value) as ColunasImpressao)}
            className={CAMPO}
            title="QR codes por linha na folha A4"
          >
            <option value={2}>2 por linha (grande)</option>
            <option value={3}>3 por linha (médio)</option>
            <option value={4}>4 por linha (pequeno)</option>
          </select>
          <button
            type="button"
            onClick={imprimirLote}
            disabled={gerandoLote || locaisVisiveis.length === 0}
            className="rounded-xl bg-amber-500 px-4 py-3 text-[13px] font-bold text-zinc-950 shadow-md disabled:opacity-50 active:translate-y-0.5"
          >
            {gerandoLote ? "A gerar..." : `🖨️ Imprimir em lote (${locaisVisiveis.length})`}
          </button>
        </div>

        {locais.length === 0 ? (
          <p className="text-[13px] text-zinc-600">Nenhum local cadastrado ainda.</p>
        ) : locaisVisiveis.length === 0 ? (
          <p className="text-[13px] text-zinc-600">Nenhum local corresponde ao filtro.</p>
        ) : (
          <div className="max-h-[480px] space-y-2.5 overflow-y-auto pr-1">
            {locaisVisiveis.map((l) => {
              const aberto = qrAbertoId === l.id;
              return (
                <div
                  key={l.id}
                  className="rounded-xl bg-zinc-950 p-3 text-[14px] ring-1 ring-zinc-800"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => setQrAbertoId(aberto ? null : l.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      title="Ver QR code"
                    >
                      <QrCodeImage conteudo={montarConteudoQr(l.qr_code_hash)} tamanho={48} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-zinc-200">
                          {l.predio} — {l.local}
                        </p>
                        <code className="block truncate font-mono text-[12px] text-zinc-500">
                          {l.qr_code_hash}
                        </code>
                      </div>
                    </button>
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
                      <button
                        onClick={() => baixarQrPng(l)}
                        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-700"
                      >
                        ⬇ PNG
                      </button>
                      <button
                        onClick={() => prepararEdicao(l)}
                        className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-400 ring-1 ring-amber-500/30"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => excluir(l.id)}
                        className="rounded-lg bg-red-950 px-3 py-1.5 text-[12px] font-semibold text-red-400 ring-1 ring-red-500/30"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                  {aberto && (
                    <div className="mt-3 flex flex-col items-center gap-2 border-t border-zinc-800 pt-3">
                      <QrCodeImage conteudo={montarConteudoQr(l.qr_code_hash)} tamanho={220} />
                      <span className="break-all text-center font-mono text-[11px] text-zinc-500">
                        {montarConteudoQr(l.qr_code_hash)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

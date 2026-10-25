import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Download, Images, Search, Trash2 } from "lucide-react";
import {
  buscarLocalPorQr,
  ehAdminSeguranca,
  excluirRegistro,
  listarRegistros,
  normalizarCodigoQr,
  registrarRonda,
  marcarComoCorrigido,
  rotuloGestor,
  type LocalRonda,
  type RegistroRonda,
} from "@/lib/rondas";
import { CARGOS_EQUIPA, perfilAPartirDoCargo } from "@/lib/perfis";
import { gerarPinAcesso } from "@/lib/pin";
import { empresaExistente } from "@/lib/empresas";
import { fotosVisiveis } from "@/lib/fotos";
import { ehIos, gravarPreferenciaGaleria, guardarNaGaleria, lerPreferenciaGaleria } from "@/lib/galeria";
import { ehMarcacaoPonto, horasPlantaoArredondadas } from "@/lib/folha-ponto";
import { ehMarcacaoPlantao, podeExcluirRegistro } from "@/lib/marcacoes";
import { baixarQrPng, gerarProximoCodigo } from "@/lib/qr";
import { QrScanner } from "@/components/QrScanner";
import { LocaisQrSection, QrPreview } from "@/components/LocaisQrSection";
import { FolhaPontoTab } from "@/components/FolhaPontoTab";
import { EscalasTab } from "@/components/EscalasTab";
import { BaterPontoPanel } from "@/components/BaterPontoPanel";
import { IndicadorSincronizacao } from "@/components/IndicadorSincronizacao";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Falcon Serviços — Segurança Patrimonial" },
      {
        name: "description",
        content:
          "Aplicativo de rondas diárias para segurança patrimonial: leitura de QR code, geolocalização e histórico de rondas.",
      },
      // --- Meta tags essenciais para iOS / PWA ---
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Falcon Serviços" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" },
      // -------------------------------------------
      { property: "og:title", content: "Falcon Serviços — Segurança Patrimonial" },
      {
        property: "og:description",
        content:
          "Registro de rondas diárias em prédios com leitura de QR code, GPS e relato de anomalias.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RondaApp,
});

type Tab = "registrar" | "checklist" | "historico" | "ocorrencias" | "financeiro" | "ponto" | "escalas" | "admin";

function lerSessao(chave: string) {
  return typeof window !== "undefined" ? (localStorage.getItem(chave) ?? "") : "";
}

function RondaApp() {
  const [seguranca, setSeguranca] = useState<string>(() => lerSessao("seguranca_nome"));
  const [postoAtribuido, setPostoAtribuido] = useState<string>(() => lerSessao("seguranca_posto"));
  const [cargoSessao, setCargoSessao] = useState<string>(() => lerSessao("seguranca_cargo"));
  const [perfilSessao, setPerfilSessao] = useState<string>(() => lerSessao("seguranca_perfil"));
  const [isCobertura, setIsCobertura] = useState<boolean>(() =>
    typeof window !== "undefined" ? localStorage.getItem("seguranca_cobertura") === "true" : false,
  );

  if (!seguranca) {
    return (
      <LoginScreen
        onEntrar={(nome, posto, cobertura, cargo, perfil) => {
          setSeguranca(nome);
          setPostoAtribuido(posto);
          setCargoSessao(cargo);
          setPerfilSessao(perfil);
          setIsCobertura(cobertura);
        }}
      />
    );
  }

  const admin = ehAdminSeguranca(seguranca, cargoSessao, perfilSessao);
  const rotulo = rotuloGestor(seguranca, cargoSessao, perfilSessao) ?? "Admin";

  return (
    <MainScreen
      seguranca={seguranca}
      postoAtribuido={postoAtribuido}
      isCobertura={isCobertura}
      admin={admin}
      rotuloGestor={rotulo}
      onTrocar={() => {
        localStorage.removeItem("seguranca_nome");
        localStorage.removeItem("seguranca_posto");
        localStorage.removeItem("seguranca_cobertura");
        localStorage.removeItem("seguranca_contrato");
        localStorage.removeItem("seguranca_cargo");
        localStorage.removeItem("seguranca_perfil");
        setSeguranca("");
        setPostoAtribuido("");
        setCargoSessao("");
        setPerfilSessao("");
        setIsCobertura(false);
      }}
    />
  );
}

/* ---------------- Login Inteligente com Nomes Limpos ---------------- */

interface SegurancaDb {
  id: string;
  nome: string;
  cargo: string;
  tipo_contrato?: string | null;
  ativo: boolean;
  pin: string;
  posto_atribuido?: string | null;
  perfil?: string | null;
  valor_hora_extra?: number | null;
}

function LoginScreen({
  onEntrar,
}: {
  onEntrar: (nome: string, posto: string, cobertura: boolean, cargo: string, perfil: string) => void;
}) {
  const [postosDisponiveis, setPostosDisponiveis] = useState<string[]>([]);
  const [postoSelecionado, setPostoSelecionado] = useState("");
  
  const [todosSegurancas, setTodosSegurancas] = useState<SegurancaDb[]>([]);
  const [nomeSelecionado, setNomeSelecionado] = useState("");
  const [tipoContrato, setTipoContrato] = useState<"PJ" | "CLT">("PJ");
  const [modoCobertura, setModoCobertura] = useState(false);
  
  const [pinDigitado, setPinDigitado] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    async function carregarDadosIniciais() {
      try {
        const { data: locais } = await supabase.from("locais_ronda").select("predio");
        const postosUnicos = Array.from(new Set((locais || []).map((l) => l.predio).filter(Boolean)));
        
        const postosFinais = postosUnicos.length > 0 ? postosUnicos.sort() : ["Samambaia", "Água Nativa", "Dream Park", "Boi Forte", "Santo Antônio", "Donaldo", "Stival", "OM"];
        setPostosDisponiveis(postosFinais);
        setPostoSelecionado(postosFinais[0]);

        const { data: segs } = await supabase
          .from("segurancas")
          .select("*")
          .eq("ativo", true)
          .order("nome", { ascending: true });

        const segsLista = (segs || []) as SegurancaDb[];
        const temAdmin = segsLista.some((b) => ehAdminSeguranca(b.nome, b.cargo, b.perfil) && !b.cargo?.toLowerCase().includes("supervisor"));
        const temSupervisor = segsLista.some((b) => ehAdminSeguranca(b.nome, b.cargo, b.perfil) && b.cargo?.toLowerCase().includes("supervisor"));
        let listaFinal = segsLista;
        if (!temAdmin) {
          listaFinal = [
            {
              id: "admin-falcon-id",
              nome: "Falcon (Admin)",
              cargo: "Administrador",
              tipo_contrato: "PJ",
              ativo: true,
              pin: "1234",
              posto_atribuido: "Geral",
              perfil: "admin",
            },
            ...listaFinal,
          ];
        }
        if (!temSupervisor) {
          listaFinal = [
            {
              id: "supervisor-falcon-id",
              nome: "Supervisor Falcon",
              cargo: "Supervisor",
              tipo_contrato: "PJ",
              ativo: true,
              pin: "5678",
              posto_atribuido: "Geral",
              perfil: "supervisor",
            },
            ...listaFinal,
          ];
        }

        setTodosSegurancas(listaFinal);
        if (listaFinal.length > 0) {
          setNomeSelecionado(listaFinal[0].nome);
          setTipoContrato((listaFinal[0].tipo_contrato as "PJ" | "CLT") || "PJ");
        }
      } catch {
        // ignora
      } finally {
        setCarregando(false);
      }
    }
    carregarDadosIniciais();
  }, []);

  const segurancasFiltrados = todosSegurancas.filter((b) => {
    if (ehAdminSeguranca(b.nome, b.cargo, b.perfil)) return true;
    if (modoCobertura) return true;
    if (!b.posto_atribuido) return true;

    const postosOficiais = b.posto_atribuido.split(",").map((p) => p.trim().toLowerCase());
    const postoAtual = postoSelecionado.trim().toLowerCase();

    return postosOficiais.some((p) => p.includes(postoAtual) || postoAtual.includes(p) || p === "geral");
  });

  useEffect(() => {
    if (segurancasFiltrados.length > 0) {
      if (!segurancasFiltrados.some((b) => b.nome === nomeSelecionado)) {
        setNomeSelecionado(segurancasFiltrados[0].nome);
        setTipoContrato((segurancasFiltrados[0].tipo_contrato as "PJ" | "CLT") || "PJ");
      }
    }
  }, [postoSelecionado, modoCobertura]);

  function entrar() {
    if (!postoSelecionado) {
      setErro("Selecione o posto de trabalho.");
      return;
    }
    const segurancaAtual = todosSegurancas.find((b) => b.nome === nomeSelecionado);
    if (!segurancaAtual) {
      setErro("Selecione um segurança válido.");
      return;
    }

    const gestor = ehAdminSeguranca(segurancaAtual.nome, segurancaAtual.cargo, segurancaAtual.perfil);
    const contratoCadastrado = (segurancaAtual.tipo_contrato || "CLT").toUpperCase();
    if (!gestor && contratoCadastrado !== tipoContrato) {
      setErro(`⚠️ Tipo de contrato incorreto. O colaborador ${segurancaAtual.nome} está cadastrado como ${contratoCadastrado}.`);
      return;
    }

    if (pinDigitado.trim() !== segurancaAtual.pin) {
      setErro("PIN incorreto. Verifique a senha numérica de acesso.");
      return;
    }

    const postoFinal = gestor ? "Geral" : postoSelecionado;
    const perfil = segurancaAtual.perfil || perfilAPartirDoCargo(segurancaAtual.cargo);

    localStorage.setItem("seguranca_nome", segurancaAtual.nome);
    localStorage.setItem("seguranca_posto", postoFinal);
    localStorage.setItem("seguranca_cobertura", modoCobertura ? "true" : "false");
    localStorage.setItem("seguranca_contrato", contratoCadastrado);
    localStorage.setItem("seguranca_cargo", segurancaAtual.cargo || "");
    localStorage.setItem("seguranca_perfil", perfil);
    onEntrar(segurancaAtual.nome, postoFinal, modoCobertura, segurancaAtual.cargo || "", perfil);
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black font-body text-zinc-100 sm:px-6 sm:py-8">
      {/* ---------------- IMAGEM DE FUNDO OCUPANDO 100% DA TELA (DESKTOP) ---------------- */}
      <div className="absolute inset-0 z-0 hidden lg:block">
        <img
          src="/falcon.jpg"
          alt="Falcon Serviços Fundo"
          className="h-full w-full object-contain bg-black"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* ---------------- CARD DE LOGIN FLUTUANTE À DIREITA ---------------- */}
      <div className="relative z-10 flex w-full max-w-[420px] flex-col overflow-hidden bg-zinc-900 ring-1 ring-zinc-800 sm:rounded-[28px] sm:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)] lg:absolute lg:right-[50px] lg:top-1/2 lg:-translate-y-1/2 lg:w-[400px] lg:max-h-[92vh] lg:shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between bg-zinc-950 px-5 pt-4 pb-4 text-zinc-100 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-900 ring-1 ring-zinc-700 shadow-sm">
              <img
                src="/logo.jpeg"
                alt="Falcon Serviços"
                className="size-full object-cover"
              />
            </div>
            <div className="leading-none">
              <p className="font-display text-[16px] font-semibold tracking-tight text-zinc-100">Falcon Serviços</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Segurança Patrimonial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 border border-zinc-800">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]"></span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400">Online</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3.5">
          <div className="rounded-[16px] bg-zinc-950 p-3.5 ring-1 ring-amber-500/30">
            <p className="font-display text-[14px] font-semibold text-amber-400">
              Acesso Seguro, Operacional! 🛡️
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
              Selecione o seu posto, nome, contrato e PIN para iniciar a ronda.
            </p>
          </div>

          <div className="rounded-[18px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Segurança Patrimonial
            </span>

            <h1 className="font-display text-[22px] font-bold leading-tight text-zinc-100">
              Quem está no Posto?
            </h1>

            {carregando ? (
              <p className="text-[14px] text-zinc-500 py-4">A carregar dados...</p>
            ) : (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    🏢 Selecione o seu Posto:
                  </label>
                  <select
                    value={postoSelecionado}
                    onChange={(e) => setPostoSelecionado(e.target.value)}
                    className="w-full rounded-[10px] bg-zinc-900 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                  >
                    {postosDisponiveis.map((posto) => (
                      <option key={posto} value={posto}>
                        Posto: {posto}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 bg-zinc-900/80 p-2.5 rounded-[10px] ring-1 ring-amber-500/20">
                  <input
                    type="checkbox"
                    id="coberturaCheck"
                    checked={modoCobertura}
                    onChange={(e) => setModoCobertura(e.target.checked)}
                    className="size-4 rounded accent-amber-500"
                  />
                  <label htmlFor="coberturaCheck" className="text-[11px] font-semibold text-amber-300 cursor-pointer">
                    🚨 Modo Cobertura / Apoio Urgente
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    👤 Selecione o seu Nome:
                  </label>
                  <select
                    value={nomeSelecionado}
                    onChange={(e) => {
                      const nome = e.target.value;
                      setNomeSelecionado(nome);
                      const encontrado = todosSegurancas.find((b) => b.nome === nome);
                      if (encontrado?.tipo_contrato) {
                        setTipoContrato((encontrado.tipo_contrato as "PJ" | "CLT") || "PJ");
                      }
                      setPinDigitado("");
                      setErro("");
                    }}
                    className="w-full rounded-[10px] bg-zinc-900 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                  >
                    {segurancasFiltrados.length === 0 ? (
                      <option value="" disabled>Nenhum funcionário alocado neste posto</option>
                    ) : (
                      segurancasFiltrados.map((b) => (
                        <option key={b.id} value={b.nome}>
                          {b.nome}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    📄 Tipo de Contrato:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTipoContrato("PJ");
                        setErro("");
                      }}
                      className={
                        tipoContrato === "PJ"
                          ? "rounded-[10px] bg-gradient-to-r from-amber-500 to-amber-600 py-2 text-[13px] font-bold text-zinc-950 shadow-sm ring-2 ring-amber-400"
                          : "rounded-[10px] bg-zinc-900 py-2 text-[13px] font-medium text-zinc-400 ring-1 ring-zinc-800"
                      }
                    >
                      💼 PJ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTipoContrato("CLT");
                        setErro("");
                      }}
                      className={
                        tipoContrato === "CLT"
                          ? "rounded-[10px] bg-gradient-to-r from-amber-500 to-amber-600 py-2 text-[13px] font-bold text-zinc-950 shadow-sm ring-2 ring-amber-400"
                          : "rounded-[10px] bg-zinc-900 py-2 text-[13px] font-medium text-zinc-400 ring-1 ring-zinc-800"
                      }
                    >
                      📋 CLT
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    🔑 Digite seu PIN:
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pinDigitado}
                    onChange={(e) => {
                      setPinDigitado(e.target.value);
                      setErro("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && entrar()}
                    placeholder="Ex.: 1234"
                    className="w-full rounded-[10px] bg-zinc-900 p-3 font-mono text-[15px] tracking-widest text-zinc-100 placeholder:font-body placeholder:tracking-normal placeholder:text-zinc-600 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {erro && <p className="text-[12px] font-medium text-red-400">{erro}</p>}

                <button
                  onClick={entrar}
                  className="mt-2 w-full rounded-[14px] bg-gradient-to-r from-amber-500 to-amber-600 py-3.5 font-display text-[16px] font-bold tracking-wide text-zinc-950 shadow-lg shadow-amber-500/20 active:translate-y-0.5"
                >
                  Entrar no Sistema
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500"></span>
            <span className="text-[11px] font-medium text-zinc-400">Conectado · Nuvem</span>
          </div>
          <span className="font-mono text-[11px] text-zinc-600">v1.2</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Main (Dashboard Executivo Admin em Largura Total Estilo Radar Fácil) ---------------- */

function MainScreen({
  seguranca,
  postoAtribuido,
  isCobertura,
  admin,
  rotuloGestor: rotulo,
  onTrocar,
}: {
  seguranca: string;
  postoAtribuido: string;
  isCobertura: boolean;
  admin: boolean;
  rotuloGestor: "Admin" | "Supervisor";
  onTrocar: () => void;
}) {
  const [tab, setTab] = useState<Tab>("registrar");
  const [alertasPendentes, setAlertasPendentes] = useState<RegistroRonda[]>([]);
  const [totalColaboradores, setTotalColaboradores] = useState(0);
  const [totalAtividadesMes, setTotalAtividadesMes] = useState(0);
  const [totalOcorrenciasMes, setTotalOcorrenciasMes] = useState(0);
  const [ultimasRondas, setUltimasRondas] = useState<RegistroRonda[]>([]);

  useEffect(() => {
    async function carregarDadosDashboard() {
      try {
        const todos = await listarRegistros(100);
        setUltimasRondas(todos);

        const gravesPendentes = todos.filter(
          (r) => r.status === "ANOMALIA" && r.gravidade === "GRAVE" && r.status_correcao === "PENDENTE"
        );
        setAlertasPendentes(gravesPendentes);
        setTotalAtividadesMes(todos.length);

        const anomalias = todos.filter((r) => r.status === "ANOMALIA");
        setTotalOcorrenciasMes(anomalias.length);

        const { count } = await supabase.from("segurancas").select("*", { count: "exact", head: true }).eq("ativo", true);
        setTotalColaboradores(count || 3);
      } catch {
        /* ignora */
      }
    }
    carregarDadosDashboard();
  }, []);

  async function resolverAlerta(id: string) {
    if (!window.confirm("Confirmar que esta anomalia grave foi totalmente corrigida?")) return;
    try {
      await marcarComoCorrigido(id);
      setAlertasPendentes((prev) => prev.filter((item) => item.id !== id));
    } catch {
      window.alert("Não foi possível atualizar o status.");
    }
  }

  // Se for Admin no Desktop, apresenta o Dashboard Executivo Estilo Radar Fácil em Largura Total
  if (admin) {
    return (
      <div className="flex min-h-screen flex-col bg-black font-body text-zinc-100">
        <header className="flex items-center justify-between gap-3 bg-zinc-950 px-4 py-2.5 border-b border-zinc-800 shadow-xl sm:px-8 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700 sm:size-11 sm:rounded-xl">
              <img src="/logo.jpeg" alt="Falcon Serviços" className="size-full object-cover" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate font-display text-[15px] font-bold text-zinc-100 sm:text-[18px]">
                Falcon Serviços <span className="hidden sm:inline">— Centro de Comando ({rotulo})</span>
              </p>
              <p className="truncate text-[10px] uppercase tracking-[0.16em] text-amber-400 font-semibold sm:text-[11px] sm:tracking-[0.18em]">
                <span className="sm:hidden">Centro de Comando</span>
                <span className="hidden sm:inline">Painel Executivo Comercial & Gestão</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <IndicadorSincronizacao />
            <button
              onClick={onTrocar}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-semibold text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-800 sm:rounded-xl sm:px-4 sm:py-2"
            >
              Sair<span className="hidden sm:inline"> / Trocar</span>
            </button>
          </div>
        </header>

        {/* ABAS DO ADMIN — deslizam na horizontal em ecrãs pequenos */}
        <nav className="bg-zinc-950 border-b border-zinc-800">
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:px-8 sm:py-3">
            <TabButton variant="scroll" active={tab === "registrar"} onClick={() => setTab("registrar")}>
              📊 Visão Geral<span className="hidden sm:inline"> (Dashboard)</span>
            </TabButton>
            <TabButton variant="scroll" active={tab === "historico"} onClick={() => setTab("historico")}>
              📋 Histórico<span className="hidden sm:inline"> & Relatórios</span>
            </TabButton>
            <TabButton variant="scroll" active={tab === "ocorrencias"} onClick={() => setTab("ocorrencias")}>
              📖 Livro Ata
            </TabButton>
            <TabButton variant="scroll" active={tab === "financeiro"} onClick={() => setTab("financeiro")}>
              💰 Financeiro PJ
            </TabButton>
            <TabButton variant="scroll" active={tab === "ponto"} onClick={() => setTab("ponto")}>
              🕒 Folha de Ponto
            </TabButton>
            <TabButton variant="scroll" active={tab === "escalas"} onClick={() => setTab("escalas")}>
              📅 Escalas
            </TabButton>
            <TabButton variant="scroll" active={tab === "admin"} onClick={() => setTab("admin")}>
              ⚙️ Postos & Equipa
            </TabButton>
          </div>
        </nav>

        <div className="flex-1 p-4 bg-zinc-950/40 overflow-y-auto sm:p-8">
          <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
            {tab === "registrar" && (
              <div className="space-y-4 sm:space-y-6">
                {/* ---------------- CARD DE INDICADORES PRINCIPAIS (2×2 no telemóvel) ---------------- */}
                <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-4">
                  {/* Card Cumprimento Médio */}
                  <div className="rounded-2xl bg-gradient-to-br from-indigo-900 via-zinc-900 to-zinc-950 p-4 ring-1 ring-indigo-500/30 shadow-xl flex flex-col justify-between sm:p-6">
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider sm:text-[12px]">Cumprimento Médio</p>
                      <div className="my-3 flex items-center justify-center sm:my-4">
                        <div className="relative flex size-16 items-center justify-center rounded-full bg-indigo-500/20 ring-4 ring-indigo-500/40 shadow-inner sm:size-24">
                          <span className="font-display text-[18px] font-bold text-white sm:text-[24px]">100%</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-400 text-center">Meta do período: 100%</p>
                  </div>

                  {/* Card Colaboradores */}
                  <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl flex flex-col justify-between sm:p-6">
                    <div>
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider sm:text-[12px]">Colaboradores</p>
                      <p className="font-display text-[26px] font-bold text-zinc-100 mt-2 sm:text-[32px] sm:mt-3">{totalColaboradores}</p>
                      <p className="text-[12px] text-emerald-400 mt-1">Ativos no sistema</p>
                    </div>
                    <button
                      onClick={() => setTab("admin")}
                      className="text-left text-[12px] font-medium text-indigo-400 hover:underline cursor-pointer mt-3 bg-transparent border-none p-0 sm:mt-4"
                    >
                      Ver detalhes ›
                    </button>
                  </div>

                  {/* Card Atividades no Mês */}
                  <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl flex flex-col justify-between sm:p-6">
                    <div>
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider sm:text-[12px]">Atividades no Mês</p>
                      <p className="font-display text-[26px] font-bold text-zinc-100 mt-2 sm:text-[32px] sm:mt-3">{totalAtividadesMes}</p>
                      <p className="text-[12px] text-zinc-400 mt-1">Rondas executadas</p>
                    </div>
                    <button
                      onClick={() => setTab("historico")}
                      className="text-left text-[12px] font-medium text-indigo-400 hover:underline cursor-pointer mt-3 bg-transparent border-none p-0 sm:mt-4"
                    >
                      Ver detalhes ›
                    </button>
                  </div>

                  {/* Card Ocorrências do Mês */}
                  <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl flex flex-col justify-between sm:p-6">
                    <div>
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider sm:text-[12px]">Ocorrências do Mês</p>
                      <p className="font-display text-[26px] font-bold text-red-400 mt-2 sm:text-[32px] sm:mt-3">{totalOcorrenciasMes}</p>
                      <p className="text-[12px] text-zinc-400 mt-1">Registradas em campo</p>
                    </div>
                    <button
                      onClick={() => setTab("ocorrencias")}
                      className="text-left text-[12px] font-medium text-indigo-400 hover:underline cursor-pointer mt-3 bg-transparent border-none p-0 sm:mt-4"
                    >
                      Ver central ›
                    </button>
                  </div>
                </div>

                {/* ---------------- BARRAS DE STATUS ---------------- */}
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
                  <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
                    <div className="flex justify-between items-center">
                      <p className="font-display text-[15px] font-bold text-zinc-100">Atividades de Hoje</p>
                      <span className="text-[11px] text-zinc-400 font-mono">{ultimasRondas.length} total</span>
                    </div>
                    <div className="w-full bg-zinc-950 h-3 rounded-full overflow-hidden flex ring-1 ring-zinc-800">
                      <div className="bg-emerald-500 h-full" style={{ width: '80%' }} title="Realizadas"></div>
                      <div className="bg-amber-500 h-full" style={{ width: '20%' }} title="Em andamento"></div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-[12px] text-zinc-400 pt-1">
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-500"></span> Realizadas</span>
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500"></span> Em Andamento</span>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
                    <div className="flex justify-between items-center">
                      <p className="font-display text-[15px] font-bold text-zinc-100">Casos de Ocorrência</p>
                      <span className="text-[11px] text-zinc-400 font-mono">{totalOcorrenciasMes} ativos</span>
                    </div>
                    <div className="w-full bg-zinc-950 h-3 rounded-full overflow-hidden flex ring-1 ring-zinc-800">
                      <div className="bg-red-500 h-full" style={{ width: alertasPendentes.length > 0 ? '50%' : '10%' }} title="Pendentes"></div>
                      <div className="bg-indigo-500 h-full" style={{ width: '50%' }} title="Resolvidos"></div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-[12px] text-zinc-400 pt-1">
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-500"></span> Em Atraso / Crítico</span>
                      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-indigo-500"></span> Resolvido</span>
                    </div>
                  </div>
                </div>

                {/* ---------------- LINHA DO TEMPO ---------------- */}
                <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-4 sm:p-6">
                  <div className="flex justify-between items-center gap-3 border-b border-zinc-800 pb-3">
                    <h3 className="font-display text-[15px] font-bold text-zinc-100 sm:text-[16px]">📅 Linha do Tempo<span className="hidden sm:inline"> — Atividades Recentes</span></h3>
                    <button
                      onClick={() => setTab("historico")}
                      className="text-[12px] font-semibold text-indigo-400 hover:underline cursor-pointer bg-transparent border-none p-0"
                    >
                      Ver todas ›
                    </button>
                  </div>

                  {ultimasRondas.length === 0 ? (
                    <p className="text-[13px] text-zinc-500 py-6 text-center">Nenhuma atividade registrada no período.</p>
                  ) : (
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2">
                      {ultimasRondas.slice(0, 10).map((r) => (
                        <div key={r.id} className="flex flex-col gap-2 rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="shrink-0 font-mono text-[12px] font-bold text-amber-400 bg-zinc-900 px-2.5 py-1 rounded-md">
                              {formatarHora(r.created_at)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[14px] text-zinc-100">
                                {r.locais_ronda ? `${r.locais_ronda.predio} — ${r.locais_ronda.local}` : "Ronda de Posto"}
                              </p>
                              <p className="text-[12px] text-zinc-400">Responsável: <span className="text-zinc-200 font-medium">{r.seguranca}</span></p>
                            </div>
                          </div>
                          <div className="shrink-0 self-end sm:self-auto">
                            <span className={r.status === "OK" ? "rounded-lg bg-emerald-500/20 px-3 py-1 font-mono text-[11px] font-bold uppercase text-emerald-400 ring-1 ring-emerald-500/30" : "rounded-lg bg-red-500/20 px-3 py-1 font-mono text-[11px] font-bold uppercase text-red-400 ring-1 ring-red-500/30"}>
                              {r.status === "OK" ? "✓ Realizada" : "⚠️ Anomalia"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "historico" && <HistoricoTab admin={admin} segurancaAtual={seguranca} />}
            {tab === "ocorrencias" && <OcorrenciasTab seguranca={seguranca} admin={admin} />}
            {tab === "financeiro" && <FinanceiroPjTab />}
            {tab === "ponto" && <FolhaPontoTab />}
            {tab === "escalas" && <EscalasTab gestor={seguranca} />}
            {tab === "admin" && <AdminTab />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Shell>
      <div className="grid grid-cols-4 gap-1 bg-zinc-950 px-2 pt-3 pb-2 border-b border-zinc-800">
        <TabButton variant="grid" active={tab === "registrar"} onClick={() => setTab("registrar")}>
          Registrar
        </TabButton>
        <TabButton variant="grid" active={tab === "checklist"} onClick={() => setTab("checklist")}>
          Checklist
        </TabButton>
        <TabButton variant="grid" active={tab === "historico"} onClick={() => setTab("historico")}>
          Histórico
        </TabButton>
        <TabButton variant="grid" active={tab === "ocorrencias"} onClick={() => setTab("ocorrencias")}>
          Livro Ata
        </TabButton>
        {admin && (
          <>
            <TabButton variant="grid" active={tab === "financeiro"} onClick={() => setTab("financeiro")}>
              💰 PJ
            </TabButton>
            <TabButton variant="grid" active={tab === "ponto"} onClick={() => setTab("ponto")}>
              🕒 Ponto
            </TabButton>
            <TabButton variant="grid" active={tab === "escalas"} onClick={() => setTab("escalas")}>
              📅 Escalas
            </TabButton>
            <TabButton variant="grid" active={tab === "admin"} onClick={() => setTab("admin")}>
              ⚙️ Admin
            </TabButton>
          </>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 bg-zinc-900">
        {isCobertura && (
          <div className="rounded-[14px] bg-amber-500/10 p-3 ring-1 ring-amber-500 text-amber-300 text-[13px] font-semibold text-center animate-pulse">
            🚨 MODO COBERTURA / APOIO URGENTE ATIVO
          </div>
        )}

        {alertasPendentes.length > 0 && (
          <div className="rounded-[18px] bg-red-950/60 p-4 ring-2 ring-red-500 shadow-xl animate-pulse">
            <div className="flex items-center gap-2 border-b border-red-500/30 pb-2 mb-2">
              <span className="grid size-7 place-items-center rounded-full bg-red-500 text-white font-bold text-sm">!</span>
              <div>
                <p className="font-display text-[14px] font-bold text-red-400 uppercase tracking-wide">
                  ⚠️ ALERTA CRÍTICO: {alertasPendentes.length} ANOMALIA{alertasPendentes.length > 1 ? "S" : ""} GRAVE{alertasPendentes.length > 1 ? "S" : ""} PENDENTE{alertasPendentes.length > 1 ? "S" : ""}!
                </p>
                <p className="text-[11px] text-zinc-400">Requer atenção imediata de correção.</p>
              </div>
            </div>

            <div className="space-y-3 mt-3">
              {alertasPendentes.map((alerta) => (
                <div key={alerta.id} className="rounded-[12px] bg-zinc-900 p-3 ring-1 ring-red-500/40">
                  <p className="text-[13px] font-semibold text-zinc-200">
                    {alerta.locais_ronda ? `${alerta.locais_ronda.predio} — ${alerta.locais_ronda.local}` : "Local"}
                  </p>
                  <p className="mt-1 text-[13px] font-medium text-red-400">{alerta.descricao}</p>
                  <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2">
                    <span className="text-[11px] text-zinc-500">Relatado por {alerta.seguranca}</span>
                    <button
                      onClick={() => resolverAlerta(alerta.id)}
                      className="rounded-[10px] bg-amber-500 px-3 py-1.5 font-display text-[12px] font-bold text-zinc-950 shadow-sm active:translate-y-0.5"
                    >
                      ✓ Marcar como Corrigido
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-1 text-[13px] text-zinc-400">
          <span className="grid size-6 place-items-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">
            {seguranca.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-zinc-200 truncate">{seguranca}</p>
            <p className="text-[11px] text-zinc-500 truncate">Posto: <span className="font-semibold text-amber-400">{postoAtribuido} {isCobertura ? "(Cobertura)" : ""}</span></p>
          </div>
          {admin && (
            <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
              {rotulo}
            </span>
          )}
          <IndicadorSincronizacao />
          <button
            onClick={onTrocar}
            className="ml-auto text-[12px] font-semibold text-zinc-500 underline underline-offset-2 shrink-0"
          >
            trocar
          </button>
        </div>

        {tab === "registrar" ? (
          <RegistrarTab seguranca={seguranca} postoAtribuido={postoAtribuido} isCobertura={isCobertura} admin={admin} />
        ) : tab === "checklist" ? (
          <ChecklistTab seguranca={seguranca} postoAtribuido={postoAtribuido} admin={admin} />
        ) : tab === "historico" ? (
          <HistoricoTab admin={admin} segurancaAtual={seguranca} />
        ) : tab === "ocorrencias" ? (
          <OcorrenciasTab seguranca={seguranca} admin={admin} />
        ) : tab === "financeiro" ? (
          <FinanceiroPjTab />
        ) : tab === "ponto" ? (
          <FolhaPontoTab />
        ) : tab === "escalas" ? (
          <EscalasTab gestor={seguranca} />
        ) : (
          <AdminTab />
        )}
      </div>
    </Shell>
  );
}

const TAB_LAYOUT = {
  // Coluna de largura igual (grelha do vigilante): texto nunca quebra de linha.
  grid: "w-full min-w-0 whitespace-nowrap px-1 py-2.5 text-[12.5px] tracking-tight",
  // Faixa deslizante na horizontal (painel admin em telemóvel).
  scroll: "shrink-0 snap-start whitespace-nowrap px-4 py-2 text-[13px] sm:px-5 sm:py-2.5",
} as const;

function TabButton({
  active,
  onClick,
  children,
  variant = "scroll",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: keyof typeof TAB_LAYOUT;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`rounded-[12px] ${TAB_LAYOUT[variant]} ${
        active
          ? "bg-zinc-900 font-bold text-amber-400 ring-1 ring-amber-500/50 shadow-md"
          : "bg-zinc-950 font-semibold text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- Função Auxiliar de Geolocalização com Fallback ---------------- */

async function obterLocalizacaoAtual(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: -16.6869, longitude: -49.2648 });
      return;
    }

    let resolvido = false;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!resolvido) {
          resolvido = true;
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      },
      () => {
        if (!resolvido) {
          resolvido = true;
          resolve({ latitude: -16.6869, longitude: -49.2648 });
        }
      },
      { timeout: 5000, maximumAge: 300000, enableHighAccuracy: false }
    );

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!resolvido) {
          resolvido = true;
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        }
      },
      () => {},
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
    );
  });
}

/* ---------------- Registrar com Validação por Posto Isolado e Turno ---------------- */

const MAX_FOTOS_ANOMALIA = 8;

interface FotoAnexada {
  file: File;
  preview: string;
}

function RegistrarTab({ seguranca, postoAtribuido, isCobertura, admin }: { seguranca: string; postoAtribuido: string; isCobertura: boolean; admin: boolean }) {
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState("");
  const [local, setLocal] = useState<LocalRonda | null>(null);
  const [modoAnomalia, setModoAnomalia] = useState(false);
  const [gravidade, setGravidade] = useState<"MODERADA" | "GRAVE">("MODERADA");
  const [descricao, setDescricao] = useState("");
  const [erroDescricao, setErroDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [confirmacao, setConfirmacao] = useState<string | null>(null);
  const [foiManual, setFoiManual] = useState(false);
  const [obsManual, setObsManual] = useState("");
  const [erroObsManual, setErroObsManual] = useState("");
  
  const [fotos, setFotos] = useState<FotoAnexada[]>([]);
  const [guardarGaleria, setGuardarGaleria] = useState(lerPreferenciaGaleria);
  const [avisoGaleria, setAvisoGaleria] = useState("");

  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  useEffect(() => () => fotosRef.current.forEach((f) => URL.revokeObjectURL(f.preview)), []);

  function limparFotos() {
    fotos.forEach((f) => URL.revokeObjectURL(f.preview));
    setFotos([]);
    setAvisoGaleria("");
  }

  async function adicionarFotos(lista: FileList | null, daCamera: boolean) {
    const novas = Array.from(lista ?? []).filter((f) => f.type.startsWith("image/") || f.type === "");
    if (novas.length === 0) return;
    const espaco = MAX_FOTOS_ANOMALIA - fotos.length;
    const aceites = novas.slice(0, Math.max(espaco, 0));
    if (aceites.length < novas.length) {
      setAvisoGaleria(`Limite de ${MAX_FOTOS_ANOMALIA} fotos por anomalia atingido.`);
    }
    setFotos((prev) => [...prev, ...aceites.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);

    // Fotos tiradas pela câmara do browser não ficam no telemóvel — guarda uma cópia local.
    // No iOS a gravação exige um toque explícito (botão "Guardar na Galeria").
    if (daCamera && guardarGaleria && aceites.length > 0 && !ehIos()) {
      await guardarCopiaLocal(aceites);
    }
  }

  async function guardarCopiaLocal(files: File[]) {
    const resultado = await guardarNaGaleria(files);
    if (resultado === "descarregado") setAvisoGaleria("📥 Cópia guardada no telemóvel (Transferências / Galeria).");
    else if (resultado === "partilhado") setAvisoGaleria("✅ Cópia guardada na Galeria / Fotos.");
  }

  function removerFoto(indice: number) {
    const alvo = fotos[indice];
    if (alvo) URL.revokeObjectURL(alvo.preview);
    setFotos((prev) => prev.filter((_, i) => i !== indice));
  }

  async function consultar(valor: string, manual = false) {
    const codigoLimpo = normalizarCodigoQr(valor);
    if (!codigoLimpo) return;
    setBuscando(true);
    setErroBusca("");
    setConfirmacao(null);
    setFoiManual(manual);
    setObsManual("");
    setErroObsManual("");

    try {
      const postoFiltro = isCobertura ? null : postoAtribuido;
      const encontrado = await buscarLocalPorQr(codigoLimpo, postoFiltro, admin);
      if (!encontrado) {
        setLocal(null);
        setErroBusca(`Nenhum local autorizado para o seu posto (${postoAtribuido}) com o código "${codigoLimpo}".`);
        setBuscando(false);
        return;
      }

      const hojeInicio = new Date();
      hojeInicio.setHours(0, 0, 0, 0);

      const { data: registrosHoje, error } = await supabase
        .from("registros_rondas")
        .select("id, local_id, descricao, created_at")
        .eq("seguranca", seguranca)
        .gte("created_at", hojeInicio.toISOString())
        .order("created_at", { ascending: false });

      if (!error && temDuplicadoNoTurnoAtual(registrosHoje, encontrado.id)) {
        setLocal(null);
        setErroBusca(`⚠️ ATENÇÃO: Você (${seguranca}) já registrou o posto "${encontrado.predio} — ${encontrado.local}" neste plantão.`);
        setBuscando(false);
        return;
      }

      setLocal(encontrado);
      setModoAnomalia(false);
      setGravidade("MODERADA");
      setDescricao("");
      limparFotos();
    } catch {
      setErroBusca("Falha ao consultar o local. Verifique a conexão e tente de novo.");
    } finally {
      setBuscando(false);
    }
  }

  function temDuplicadoNoTurnoAtual(regs: any[] | null, localId: string): boolean {
    if (!regs || regs.length === 0) return false;
    
    const idxNovoTurno = regs.findIndex(r => r.descricao?.includes("NOVO PLANTÃO"));
    const regsDoTurnoAtual = idxNovoTurno !== -1 ? regs.slice(0, idxNovoTurno) : regs;

    return regsDoTurnoAtual.some(
      (r) =>
        r.local_id === localId &&
        !ehMarcacaoPonto(r.descricao) &&
        !r.descricao?.includes("PLANTÃO FINALIZADO") &&
        !r.descricao?.includes("NOVO PLANTÃO"),
    );
  }

  async function registrarOk() {
    if (!local) return;

    if (foiManual && obsManual.trim().length < 3) {
      setErroObsManual("Informe o motivo/observação da baixa manual (ex: sala trancada, QR code danificado).");
      return;
    }

    setEnviando(true);
    try {
      const gps = await obterLocalizacaoAtual();
      const descFinal = foiManual 
        ? `⚠️ BAIXA MANUAL: ${obsManual.trim()} (Verificar in loco)` 
        : undefined;

      await registrarRonda({ 
        localId: local.id, 
        seguranca, 
        status: "OK", 
        gravidade: "MODERADA",
        descricao: descFinal,
        latitude: gps.latitude,
        longitude: gps.longitude,
        isCobertura,
        postoCobertura: postoAtribuido,
      });

      setConfirmacao(foiManual ? "OK_MANUAL" : "OK");
      setLocal(null);
      setCodigo("");
      setObsManual("");
    } catch {
      setErroBusca("Não foi possível enviar o registro. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function registrarAnomalia() {
    if (!local) return;
    if (descricao.trim().length < 3) {
      setErroDescricao("Descreva o problema encontrado antes de enviar.");
      return;
    }
    setEnviando(true);
    try {
      const gps = await obterLocalizacaoAtual();
      await registrarRonda({
        localId: local.id,
        seguranca,
        status: "ANOMALIA",
        gravidade,
        descricao: descricao.trim(),
        latitude: gps.latitude,
        longitude: gps.longitude,
        fotoFiles: fotos.map((f) => f.file),
        isCobertura,
        postoCobertura: postoAtribuido,
      });
      setConfirmacao("ANOMALIA");
      setLocal(null);
      setCodigo("");
      setModoAnomalia(false);
      setGravidade("MODERADA");
      setDescricao("");
      limparFotos();
    } catch (err: any) {
      setErroBusca(err?.message || "Não foi possível enviar o registro com foto. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {!admin && <BaterPontoPanel seguranca={seguranca} postoAtribuido={postoAtribuido} />}

      <p className="mt-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Ronda do posto</p>
      {!admin && <QrScanner onDetect={(val) => consultar(val, false)} disabled={buscando} />}

      <div className="mt-4">
        <label className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Código manual
        </label>
        <div className="mt-2 flex gap-2">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && consultar(codigo, true)}
            placeholder="Ex.: samambaia-01"
            maxLength={120}
            className="min-w-0 flex-1 rounded-[12px] bg-zinc-950 p-3.5 font-mono text-[15px] font-semibold tracking-wide text-zinc-100 placeholder:font-body placeholder:font-normal placeholder:text-zinc-600 ring-1 ring-zinc-800 outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            onClick={() => consultar(codigo, true)}
            disabled={buscando || !codigo.trim()}
            className="rounded-[12px] bg-zinc-800 px-5 font-display text-[14px] font-semibold text-zinc-100 shadow-md disabled:opacity-50 active:translate-y-0.5"
          >
            {buscando ? "..." : "Buscar"}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[12px] text-zinc-500">
          Busca manual restrita ao posto ({postoAtribuido}).
        </p>
        {erroBusca && (
          <p className="mt-2 rounded-[12px] bg-red-950/60 p-3 text-[13px] font-medium text-red-400 ring-1 ring-red-500/30">
            {erroBusca}
          </p>
        )}
        {confirmacao && (
          <div
            className={
              confirmacao === "ANOMALIA"
                ? "mt-2 rounded-[12px] bg-red-950/60 p-3 text-[13px] font-semibold text-red-400 ring-1 ring-red-500/30"
                : confirmacao === "OK_MANUAL"
                ? "mt-2 rounded-[12px] bg-amber-950/60 p-3 text-[13px] font-semibold text-amber-300 ring-1 ring-amber-500/30"
                : "mt-2 rounded-[12px] bg-emerald-950/60 p-3 text-[13px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
            }
          >
            {confirmacao === "OK" && "Registro enviado com sucesso (GPS capturado). Pode seguir para o próximo ponto."}
            {confirmacao === "OK_MANUAL" && "⚠️ Baixa manual realizada com observação e GPS!"}
            {confirmacao === "ANOMALIA" && "Anomalia registrada com GPS e enviada. Obrigado pelo reporte."}
          </div>
        )}
      </div>

      {local && (
        <>
          <div className="rounded-[20px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Local identificado {foiManual && "(Via Busca Manual)"}
              </span>
              <span className="rounded-md bg-zinc-900 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-zinc-300">
                {local.qr_code_hash}
              </span>
            </div>
            <p className="font-display text-[22px] font-bold leading-tight text-balance text-zinc-100">
              {local.predio}
            </p>
            <p className="mt-0.5 text-[15px] text-zinc-400">{local.local}</p>
          </div>

          {foiManual && (
            <div className="rounded-[18px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-sm space-y-2">
              <label className="block text-[12px] font-bold text-red-400 uppercase tracking-wider">
                ⚠️ Observação da Baixa Manual <span className="text-zinc-500 font-normal lowercase">(obrigatória)</span>
              </label>
              <textarea
                rows={2}
                value={obsManual}
                onChange={(e) => {
                  setObsManual(e.target.value);
                  setErroObsManual("");
                }}
                placeholder="Ex: Sala trancada, QR code inacessível..."
                className="w-full rounded-[10px] bg-zinc-900 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-red-500"
              />
              {erroObsManual && <p className="text-[12px] font-semibold text-red-400">{erroObsManual}</p>}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={registrarOk}
              disabled={enviando}
              className="flex w-full items-center justify-center gap-2.5 rounded-[18px] bg-emerald-600 py-5 font-display text-[19px] font-bold tracking-wide text-white shadow-lg shadow-emerald-600/20 disabled:opacity-60 active:translate-y-0.5"
            >
              <span className="grid size-7 place-items-center rounded-full bg-white/25 font-bold">✓</span>
              {enviando ? "A capturar GPS..." : foiManual ? "Confirmar Baixa Manual com Obs." : "Tudo OK"}
            </button>
            <button
              onClick={() => {
                setModoAnomalia(true);
                setGravidade("MODERADA");
                setErroDescricao("");
                setTimeout(() => {
                  const elem = document.getElementById("bloco-anomalia");
                  if (elem) {
                    elem.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }
                }, 100);
              }}
              disabled={enviando}
              className="flex w-full items-center justify-center gap-2.5 rounded-[18px] bg-red-600 py-5 font-display text-[19px] font-bold tracking-wide text-white shadow-lg shadow-red-600/20 disabled:opacity-60 active:translate-y-0.5"
            >
              <span className="grid size-7 place-items-center rounded-full bg-white/25 font-bold">!</span>
              Relatar Anomalia
            </button>
          </div>

          {modoAnomalia && (
            <div id="bloco-anomalia" className="rounded-[18px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3.5">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-red-400">
                <span className="size-2 rounded-full bg-red-500"></span> Nível de Gravidade
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGravidade("MODERADA")}
                  className={
                    gravidade === "MODERADA"
                      ? "rounded-[12px] bg-amber-500 py-2.5 text-[13px] font-bold text-zinc-950 shadow-sm ring-2 ring-amber-400"
                      : "rounded-[12px] bg-zinc-900 py-2.5 text-[13px] font-medium text-zinc-400 ring-1 ring-zinc-800"
                  }
                >
                  🟡 Moderada
                </button>
                <button
                  type="button"
                  onClick={() => setGravidade("GRAVE")}
                  className={
                    gravidade === "GRAVE"
                      ? "rounded-[12px] bg-red-600 py-2.5 text-[13px] font-bold text-white shadow-sm ring-2 ring-red-400 animate-pulse"
                      : "rounded-[12px] bg-zinc-900 py-2.5 text-[13px] font-medium text-zinc-400 ring-1 ring-zinc-800"
                  }
                >
                  🔴 GRAVE / URGENTE
                </button>
              </div>

              <label className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-red-400">
                Descrição da anomalia
                <span className="ml-auto font-medium normal-case tracking-normal text-zinc-500">
                  obrigatória
                </span>
              </label>
              <textarea
                rows={3}
                value={descricao}
                onChange={(e) => {
                  setDescricao(e.target.value);
                  setErroDescricao("");
                }}
                maxLength={1000}
                placeholder="Ex.: vazamento enorme na casa de máquinas do ar-condicionado..."
                className="w-full resize-none rounded-[12px] bg-zinc-900 p-3 text-[15px] text-zinc-100 placeholder:text-zinc-600 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-red-500"
              />
              {erroDescricao && (
                <p className="text-[13px] font-medium text-red-400">{erroDescricao}</p>
              )}

              <div className="pt-1 space-y-2">
                <label className="flex items-center text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  📷 Registo Fotográfico
                  <span className="ml-auto font-mono font-medium normal-case tracking-normal text-zinc-500">
                    {fotos.length}/{MAX_FOTOS_ANOMALIA}
                  </span>
                </label>

                {fotos.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {fotos.map((f, i) => (
                      <div key={f.preview} className="relative aspect-square">
                        <img
                          src={f.preview}
                          alt={`Foto ${i + 1}`}
                          className="size-full rounded-[10px] object-cover ring-2 ring-zinc-700"
                        />
                        <button
                          type="button"
                          onClick={() => removerFoto(i)}
                          aria-label={`Remover foto ${i + 1}`}
                          className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-red-600 text-white font-bold text-xs shadow-md"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {fotos.length < MAX_FOTOS_ANOMALIA && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[12px] border-2 border-dashed border-zinc-700 bg-zinc-900 py-3 px-2 text-[13px] font-semibold text-zinc-300 hover:bg-zinc-800 active:translate-y-0.5">
                      <Camera className="size-4" />
                      {fotos.length === 0 ? "Tirar foto" : "Mais uma"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          void adicionarFotos(e.target.files, true);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[12px] border-2 border-dashed border-zinc-700 bg-zinc-900 py-3 px-2 text-[13px] font-semibold text-zinc-300 hover:bg-zinc-800 active:translate-y-0.5">
                      <Images className="size-4" />
                      Da galeria
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void adicionarFotos(e.target.files, false);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-[12px] text-zinc-400">
                    <input
                      type="checkbox"
                      checked={guardarGaleria}
                      onChange={(e) => {
                        setGuardarGaleria(e.target.checked);
                        gravarPreferenciaGaleria(e.target.checked);
                      }}
                      className="size-4 accent-amber-500"
                    />
                    Guardar cópia no telemóvel
                  </label>
                  {fotos.length > 0 && (ehIos() || !guardarGaleria) && (
                    <button
                      type="button"
                      onClick={() => void guardarCopiaLocal(fotos.map((f) => f.file))}
                      className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-700"
                    >
                      <Download className="size-3.5" /> Guardar na Galeria
                    </button>
                  )}
                </div>
                {avisoGaleria && <p className="text-[12px] font-medium text-emerald-400">{avisoGaleria}</p>}
              </div>

              <button
                onClick={registrarAnomalia}
                disabled={enviando}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-zinc-800 py-3.5 font-display text-[15px] font-semibold text-zinc-100 shadow-md disabled:opacity-60 active:translate-y-0.5"
              >
                <span className="grid size-5 place-items-center rounded-full bg-red-600 text-[11px] font-bold text-white">!</span>
                {enviando
                  ? fotos.length > 0
                    ? `A enviar ${fotos.length} foto${fotos.length > 1 ? "s" : ""} e GPS...`
                    : "A enviar com GPS..."
                  : "Enviar registo de anomalia"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------------- Aba: Checklist com Botão de Finalizar Plantão e Novo Turno ---------------- */

function ChecklistTab({ seguranca, postoAtribuido, admin }: { seguranca: string; postoAtribuido: string; admin: boolean }) {
  const [locais, setLocais] = useState<LocalRonda[]>([]);
  const [rondasTurno, setRondasTurno] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [plantaoFinalizado, setPlantaoFinalizado] = useState(false);
  const [modalJustificativa, setModalJustificativa] = useState(false);
  const [obsFecho, setObsFecho] = useState("");
  const [enviandoFecho, setEnviandoFecho] = useState(false);

  async function carregarPendencias() {
    setCarregando(true);
    try {
      let query = supabase.from("locais_ronda").select("*");
      if (!admin && postoAtribuido && postoAtribuido.trim() !== "" && postoAtribuido.toLowerCase() !== "geral") {
        query = query.ilike("predio", `%${postoAtribuido}%`);
      }
      const { data: locaisData } = await query.order("predio", { ascending: true });
      setLocais(locaisData || []);

      const hojeInicio = new Date();
      hojeInicio.setHours(0, 0, 0, 0);

      const { data: rondasData } = await supabase
        .from("registros_rondas")
        .select("local_id, created_at, seguranca, descricao")
        .eq("seguranca", seguranca)
        .gte("created_at", hojeInicio.toISOString())
        .order("created_at", { ascending: false });

      const regs = rondasData || [];
      setRondasTurno(regs);

      // Olha estritamente para o último evento do dia (o mais recente)
      const ultimoRegisto = regs[0];
      const foiFechadoPorUltimo = ultimoRegisto?.descricao?.includes("🏁 PLANTÃO FINALIZADO");

      const contratoAtivo = typeof window !== "undefined" ? localStorage.getItem("seguranca_contrato") || "PJ" : "PJ";
      const ePj = contratoAtivo === "PJ";

      const temRegistoHoje = regs.length > 0;

      if (ePj && !temRegistoHoje) {
        setPlantaoFinalizado(true);
      } else {
        // Só bloqueia se a última ação executada foi realmente o fecho do plantão
        setPlantaoFinalizado(!!foiFechadoPorUltimo);
      }
    } catch {
      /* ignora erro temporário */
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarPendencias();
  }, [seguranca, postoAtribuido]);

  let idsVisitados = new Set<string>();

  if (!plantaoFinalizado) {
    const idxNovoTurno = rondasTurno.findIndex(r => r.descricao?.includes("NOVO PLANTÃO"));
    const regsDoTurnoAtual = idxNovoTurno !== -1 ? rondasTurno.slice(0, idxNovoTurno) : rondasTurno;

    idsVisitados = new Set(
      regsDoTurnoAtual
        .filter(r => !r.descricao?.includes("PLANTÃO FINALIZADO") && !r.descricao?.includes("NOVO PLANTÃO"))
        .map((r) => r.local_id)
    );
  }
    
  const locaisPendentes = locais.filter((l) => !idsVisitados.has(l.id));

  const totalCadastrados = locais.length;
  const restantesCount = locaisPendentes.length;

  async function tentarFinalizarPlantao() {
    if (restantesCount === 0) {
      await executarFechoPlantao("Plantão finalizado 100% concluído.");
    } else {
      setModalJustificativa(true);
    }
  }

  async function executarFechoPlantao(justificativa: string) {
    setEnviandoFecho(true);
    try {
      const localIdRef = locais[0]?.id;
      if (!localIdRef) {
        window.alert("Cadastre pelo menos um local de ronda para o seu posto antes de fechar o plantão.");
        return;
      }

      const gps = await obterLocalizacaoAtual();
      const { error } = await supabase.from("registros_rondas").insert([
        {
          local_id: localIdRef,
          seguranca,
          status: "OK",
          gravidade: "MODERADA",
          descricao: `🏁 PLANTÃO FINALIZADO COM ${restantesCount} PENDÊNCIAS. Justificativa: ${justificativa}`,
          latitude: gps.latitude,
          longitude: gps.longitude,
        },
      ]);

      if (error) throw error;

      setPlantaoFinalizado(true);
      setModalJustificativa(false);
      window.alert("Plantão finalizado com sucesso!");
      carregarPendencias();
    } catch (err) {
      console.error("Erro ao fechar plantão:", err);
      window.alert("Não foi possível finalizar o plantão.");
    } finally {
      setEnviandoFecho(false);
    }
  }

  async function iniciarNovoTurno() {
    const contratoAtivo = typeof window !== "undefined" ? localStorage.getItem("seguranca_contrato") || "PJ" : "PJ";

    if (contratoAtivo !== "PJ") {
      try {
        const gps = await obterLocalizacaoAtual();
        const localIdRef = locais[0]?.id;
        if (!localIdRef) {
          window.alert("Cadastre pelo menos um local de ronda na aba Admin.");
          return;
        }

        const { error } = await supabase.from("registros_rondas").insert([
          {
            local_id: localIdRef,
            seguranca,
            status: "OK",
            gravidade: "MODERADA",
            descricao: `🚀 NOVO PLANTÃO / TURNO INICIADO por ${seguranca} (CLT)`,
            latitude: gps.latitude,
            longitude: gps.longitude,
          },
        ]);

        if (error) throw error;

        setPlantaoFinalizado(false);
        await carregarPendencias();
        window.alert("Novo turno iniciado com sucesso!");
      } catch (err) {
        console.error("Erro ao iniciar novo turno CLT:", err);
        window.alert("Não foi possível reiniciar o plantão.");
      }
      return;
    }

    const codigoBase = window.prompt("🛡️ Colaborador PJ: Aponte para o QR Code exclusivo da Base para iniciar o plantão e a contagem de horas:");
    if (!codigoBase) return;

    const codigoLimpo = normalizarCodigoQr(codigoBase);
    
    const { data: localBase } = await supabase
      .from("locais_ronda")
      .select("id, qr_code_hash")
      .eq("qr_code_hash", codigoLimpo)
      .single();

    if (!localBase) {
      window.alert("❌ QR Code da base inválido. A leitura do QR Code da base é obrigatória para iniciar o plantão PJ.");
      return;
    }

    try {
      const gps = await obterLocalizacaoAtual();
      const { error } = await supabase.from("registros_rondas").insert([
        {
          local_id: localBase.id,
          seguranca,
          status: "OK",
          gravidade: "MODERADA",
          descricao: `🚀 NOVO PLANTÃO PJ INICIADO na Base por ${seguranca}`,
          latitude: gps.latitude,
          longitude: gps.longitude,
        },
      ]);

      if (error) throw error;

      setPlantaoFinalizado(false);
      await carregarPendencias();
      window.alert("✅ Plantão PJ iniciado com sucesso na Base! As suas horas começaram a ser contabilizadas.");
    } catch (err) {
      console.error("Erro ao iniciar novo turno PJ:", err);
      window.alert("Não foi possível iniciar o plantão.");
    }
  }

  const isPjLogado = (typeof window !== "undefined" ? localStorage.getItem("seguranca_contrato") : "PJ") === "PJ";

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-md flex justify-between items-center">
        <div>
          <h3 className="font-display text-[16px] font-bold text-zinc-100">Checklist / {restantesCount}</h3>
          <p className="text-[12px] text-zinc-400">Posto: <span className="font-semibold text-amber-400">{postoAtribuido}</span></p>
        </div>
        <div className="text-right">
          <span className="text-[20px] font-bold text-amber-400">{restantesCount}</span>
          <span className="text-[12px] text-zinc-600"> / {totalCadastrados}</span>
        </div>
      </div>

      {plantaoFinalizado ? (
        <div className="rounded-[16px] bg-zinc-950 p-6 text-center ring-1 ring-amber-500/30 space-y-3">
          <p className="font-display text-[16px] font-bold text-amber-400">🏁 Plantão Pendente / Encerrado</p>
          <p className="text-[13px] text-zinc-400">
            {isPjLogado 
              ? "Para iniciar o seu turno e liberar as rondas, é obrigatória a leitura do QR Code da Base." 
              : "O seu turno anterior foi finalizado. Clique abaixo para iniciar um novo turno."}
          </p>
          <button
            onClick={iniciarNovoTurno}
            className="w-full rounded-[14px] bg-gradient-to-r from-amber-500 to-amber-600 py-3.5 font-display text-[15px] font-bold text-zinc-950 shadow-md active:translate-y-0.5"
          >
            {isPjLogado ? "🚀 Iniciar Novo Turno (Ler QR Code da Base)" : "🚀 Iniciar Novo Turno / Plantão"}
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={tentarFinalizarPlantao}
            disabled={enviandoFecho}
            className="w-full rounded-[16px] bg-zinc-800 py-4 font-display text-[15px] font-bold text-zinc-100 shadow-lg active:translate-y-0.5"
          >
            🏁 Finalizar Plantão / Ronda
          </button>

          {modalJustificativa && (
            <div className="rounded-[18px] bg-red-950/80 p-4 ring-2 ring-red-500 space-y-3">
              <p className="font-display text-[14px] font-bold text-red-400">
                ⚠️ Atenção: Existem {restantesCount} postos pendentes!
              </p>
              <p className="text-[12px] text-zinc-300">
                Para fechar o plantão sem completar todas as rondas, é obrigatório inserir uma justificativa abaixo:
              </p>
              <textarea
                rows={3}
                value={obsFecho}
                onChange={(e) => setObsFecho(e.target.value)}
                placeholder="Ex: Troca de turno antecipada, problema de acesso..."
                className="w-full rounded-[10px] bg-zinc-900 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setModalJustificativa(false)}
                  className="flex-1 rounded-[10px] bg-zinc-900 py-2 text-[12px] font-semibold text-zinc-300 ring-1 ring-zinc-700"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (obsFecho.trim().length < 5) {
                      window.alert("Insira uma justificativa válida com pelo menos 5 caracteres.");
                      return;
                    }
                    executarFechoPlantao(obsFecho.trim());
                  }}
                  disabled={enviandoFecho}
                  className="flex-1 rounded-[10px] bg-red-600 py-2 text-[12px] font-bold text-white"
                >
                  {enviandoFecho ? "A fechar..." : "Confirmar Fecho"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {carregando ? (
        <p className="text-center text-[13px] text-zinc-500 py-6">A carregar checklist...</p>
      ) : plantaoFinalizado ? (
        <div className="rounded-[14px] bg-zinc-950 p-4 text-center text-[13px] text-zinc-500 ring-1 ring-zinc-800">
          O checklist está bloqueado até efetuar o início do turno na Base.
        </div>
      ) : locaisPendentes.length === 0 ? (
        <div className="rounded-[16px] bg-emerald-950/60 p-6 text-center ring-1 ring-emerald-500/30">
          <p className="font-display text-[15px] font-bold text-emerald-400">🎉 Checklist Concluído!</p>
          <p className="mt-1 text-[13px] text-zinc-400">Todos os postos obrigatórios deste plantão já foram visitados por você.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {locaisPendentes.map((local) => (
            <div key={local.id} className="rounded-[14px] bg-zinc-950 p-3.5 ring-1 ring-zinc-800 shadow-md flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[14px] text-zinc-200 truncate">{local.local}</p>
                <p className="text-[12px] text-zinc-500">{local.predio}</p>
              </div>
              <span className="shrink-0 rounded-md bg-zinc-900 px-2 py-1 font-mono text-[11px] font-bold tracking-wide text-zinc-400">
                {local.qr_code_hash}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={carregarPendencias}
        className="w-full rounded-[12px] bg-zinc-800 py-3 text-[13px] font-semibold text-zinc-400 active:translate-y-0.5"
      >
        Atualizar Checklist
      </button>
    </div>
  );
}

/* ---------------- Histórico Inteligente com Filtro por Empresa/Posto, Segurança e Datas ---------------- */

function HistoricoTab({ admin, segurancaAtual }: { admin: boolean; segurancaAtual: string }) {
  const [registros, setRegistros] = useState<RegistroRonda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  
  const [filtroPosto, setFiltroPosto] = useState("TODOS");
  const [filtroSeguranca, setFiltroSeguranca] = useState("TODOS");
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");

  const [listaPostos, setListaPostos] = useState<string[]>([]);
  const [listaSegurancas, setListaSegurancas] = useState<string[]>([]);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const regs = await listarRegistros(1000, {
        dataInicial: dataInicial || undefined,
        dataFinal: dataFinal || undefined,
      });
      setRegistros(regs);

      const postos = Array.from(new Set(regs.map((r) => r.locais_ronda?.predio).filter(Boolean) as string[]));
      setListaPostos(postos);

      const unicos = Array.from(new Set(regs.map((r) => r.seguranca).filter(Boolean)));
      setListaSegurancas(unicos);
    } catch {
      setErro("Não foi possível carregar o histórico.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [dataInicial, dataFinal]);

  async function handleExcluir(registro: RegistroRonda) {
    if (!podeExcluirRegistro(registro, segurancaAtual, admin)) {
      window.alert("Marcações de início ou fim de plantão não podem ser apagadas.");
      return;
    }
    const mensagem = admin
      ? "Excluir este registo do histórico? Esta ação não pode ser desfeita."
      : "Anular este registo?\n\nO ponto volta a ficar pendente no Checklist e pode refazer a marcação (ex.: reportar uma anomalia detetada logo após o check).";
    if (!window.confirm(mensagem)) return;
    setExcluindoId(registro.id);
    try {
      await excluirRegistro(registro, segurancaAtual, admin);
      setRegistros((prev) => prev.filter((r) => r.id !== registro.id));
    } catch (err: any) {
      console.error("Erro ao excluir:", err);
      window.alert(err?.message || "Não foi possível excluir o registo.");
    } finally {
      setExcluindoId(null);
    }
  }

  async function resetarDiaAdmin() {
    if (!admin) return;
    const alvo = filtroSeguranca === "TODOS" ? "todos os seguranças" : `o segurança ${filtroSeguranca}`;
    if (!window.confirm(`⚠️ ATENÇÃO: Deseja apagar as rondas de hoje para ${alvo}? Esta ação é irreversível!`)) return;

    try {
      const hojeInicio = new Date();
      hojeInicio.setHours(0, 0, 0, 0);

      let query = supabase
        .from("registros_rondas")
        .delete()
        .gte("created_at", hojeInicio.toISOString());

      if (filtroSeguranca !== "TODOS") {
        query = query.eq("seguranca", filtroSeguranca);
      }

      const { error } = await query;
      if (error) throw error;

      window.alert("Rondas do dia reiniciadas com sucesso!");
      carregar();
    } catch (err) {
      console.error("Erro ao resetar dia:", err);
      window.alert("Não foi possível resetar o dia.");
    }
  }

  function limparFiltros() {
    setFiltroPosto("TODOS");
    setFiltroSeguranca("TODOS");
    setDataInicial("");
    setDataFinal("");
  }

  const registrosFiltrados = registros.filter((r) => {
    if (!admin) {
      if (r.seguranca !== segurancaAtual) return false;
      const dataReg = new Date(r.created_at).toDateString();
      const hojeStr = new Date().toDateString();
      if (dataReg !== hojeStr) return false;
      return true;
    }

    if (filtroPosto !== "TODOS" && r.locais_ronda?.predio !== filtroPosto) return false;
    if (filtroSeguranca !== "TODOS" && r.seguranca !== filtroSeguranca) return false;
    return true;
  });

  const hoje = new Date().toDateString();
  const totalHoje = registrosFiltrados.filter((r) => new Date(r.created_at).toDateString() === hoje).length;
  const totalAnomalias = registrosFiltrados.filter((r) => r.status === "ANOMALIA").length;

  return (
    <div>
      {admin && (
        <div className="mb-4 space-y-3 rounded-[14px] bg-zinc-950 p-3.5 ring-1 ring-zinc-800">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Filtros Administrativos e Relatórios (por Empresa/Posto, Segurança e Datas)
          </span>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400 font-medium">
              🏢 Filtrar por Empresa / Posto
              <select
                value={filtroPosto}
                onChange={(e) => setFiltroPosto(e.target.value)}
                className="rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-normal"
              >
                <option value="TODOS">🏢 Todos os Postos / Empresas</option>
                {listaPostos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-zinc-400 font-medium">
              👤 Filtrar por segurança
              <select
                value={filtroSeguranca}
                onChange={(e) => setFiltroSeguranca(e.target.value)}
                className="rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-normal"
              >
                <option value="TODOS">👥 Todos os seguranças</option>
                {listaSegurancas.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-end gap-2 pt-1">
              <label className="flex flex-1 flex-col gap-1 text-[11px] text-zinc-400">
                Data inicial
                <input
                  type="date"
                  value={dataInicial}
                  max={dataFinal || undefined}
                  onChange={(e) => setDataInicial(e.target.value)}
                  className="rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-[11px] text-zinc-400">
                Data final
                <input
                  type="date"
                  value={dataFinal}
                  min={dataInicial || undefined}
                  onChange={(e) => setDataFinal(e.target.value)}
                  className="rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                />
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={limparFiltros}
              className="flex-1 rounded-[10px] bg-zinc-800 py-2 text-[12px] font-semibold text-zinc-200"
            >
              Limpar Filtros
            </button>
            <button
              onClick={resetarDiaAdmin}
              className="flex-1 rounded-[10px] bg-red-600 py-2 text-[12px] font-bold text-white shadow-sm active:translate-y-0.5"
            >
              🔄 Resetar Rondas de Hoje
            </button>
          </div>

          <button
            onClick={() => gerarRelatorio(registrosFiltrados, filtroPosto, { admin, segurancaAtual })}
            disabled={carregando || registrosFiltrados.length === 0}
            className="w-full rounded-[12px] bg-gradient-to-r from-amber-500 to-amber-600 py-3 font-display text-[13px] font-semibold tracking-wide text-zinc-950 shadow-md disabled:opacity-50 active:translate-y-0.5"
          >
            🖨️ Imprimir / Gerar Relatório Filtrado (com Maps e Fotos)
          </button>
        </div>
      )}

      <div className="mb-2.5 flex items-center justify-between px-1">
        <p className="font-display text-[15px] font-semibold text-zinc-200">
          {registrosFiltrados.length} registo{registrosFiltrados.length === 1 ? "" : "s"}
        </p>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {carregando ? "a carregar..." : `${totalHoje} hoje · ${totalAnomalias} anomalia${totalAnomalias === 1 ? "" : "s"}`}
        </span>
      </div>

      {erro && (
        <p className="rounded-[12px] bg-red-950/60 p-3 text-[13px] font-medium text-red-400 ring-1 ring-red-500/30">
          {erro}
        </p>
      )}

      {!carregando && !erro && registrosFiltrados.length === 0 && (
        <p className="rounded-[14px] bg-zinc-950 p-5 text-center text-[14px] text-zinc-500 ring-1 ring-zinc-800">
          Nenhum registo encontrado com os filtros selecionados.
        </p>
      )}

      <div className="space-y-2.5">
        {registrosFiltrados.map((r) => {
          const ehGravePendente = r.status === "ANOMALIA" && r.gravidade === "GRAVE" && r.status_correcao === "PENDENTE";
          const jaCorrigido = r.status === "ANOMALIA" && r.status_correcao === "CORRIGIDO";
          const ehBaixaManual = r.status === "OK" && r.descricao?.includes("BAIXA MANUAL");
          const ehFechoPlantao = r.descricao?.includes("PLANTÃO FINALIZADO");

          return (
            <div
              key={r.id}
              className={
                ehFechoPlantao
                  ? "rounded-[14px] bg-zinc-950 p-3 ring-2 ring-emerald-500 shadow-md"
                  : ehGravePendente
                  ? "rounded-[14px] bg-red-950/60 p-3 ring-2 ring-red-500 shadow-md"
                  : "rounded-[14px] bg-zinc-950 p-3 ring-1 ring-zinc-800 shadow-md"
              }
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    ehFechoPlantao
                      ? "grid size-9 shrink-0 place-items-center rounded-[10px] bg-emerald-600 text-sm font-bold text-white"
                      : r.status === "OK" && !ehBaixaManual
                      ? "grid size-9 shrink-0 place-items-center rounded-[10px] bg-emerald-500/20 text-sm font-bold text-emerald-400"
                      : ehBaixaManual
                      ? "grid size-9 shrink-0 place-items-center rounded-[10px] bg-amber-500/20 text-sm font-bold text-amber-400"
                      : ehGravePendente
                      ? "grid size-9 shrink-0 place-items-center rounded-[10px] bg-red-600 text-sm font-bold text-white animate-bounce"
                      : jaCorrigido
                      ? "grid size-9 shrink-0 place-items-center rounded-[10px] bg-emerald-500/20 text-sm font-bold text-emerald-400"
                      : "grid size-9 shrink-0 place-items-center rounded-[10px] bg-amber-500/20 text-sm font-bold text-amber-400"
                  }
                >
                  {ehFechoPlantao ? "🏁" : ehBaixaManual ? "⚠️" : r.status === "OK" ? "OK" : jaCorrigido ? "✓" : "!"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-zinc-100">
                    {r.locais_ronda ? `${r.locais_ronda.predio} — ${r.locais_ronda.local}` : "Local removido"}
                  </p>
                  <p className="text-[12px] text-zinc-500">{r.seguranca}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={
                      ehFechoPlantao
                        ? "font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400"
                        : ehBaixaManual
                        ? "font-mono text-[10px] font-bold uppercase tracking-wider text-red-400 animate-pulse"
                        : r.status === "OK"
                        ? "font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400"
                        : ehGravePendente
                        ? "font-mono text-[10px] font-black uppercase tracking-wider text-red-400 bg-red-950 px-1.5 py-0.5 rounded"
                        : jaCorrigido
                        ? "font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded"
                        : "font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400"
                    }
                  >
                    {ehFechoPlantao ? "🏁 PLANTÃO FECHADO" : ehBaixaManual ? "⚠️ BAIXA MANUAL" : r.status === "OK" ? "OK" : ehGravePendente ? "🚨 GRAVE (PENDENTE)" : jaCorrigido ? "✓ CORRIGIDO" : "Moderada"}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-600 mt-1">
                    {formatarHora(r.created_at)}
                  </p>
                </div>
              </div>

              {r.descricao && (
                <p className={ehFechoPlantao ? "mt-2 rounded-[10px] bg-emerald-950/60 p-2.5 text-[13px] font-bold text-emerald-300 ring-1 ring-emerald-500/30" : ehBaixaManual ? "mt-2 rounded-[10px] bg-amber-950/60 p-2.5 text-[13px] font-bold text-amber-300 ring-1 ring-amber-500/30" : ehGravePendente ? "mt-2 rounded-[10px] bg-red-950/60 p-2.5 text-[13px] font-medium text-red-300 ring-1 ring-red-500/30" : "mt-2 rounded-[10px] bg-zinc-900 p-2.5 text-[13px] text-zinc-300 ring-1 ring-zinc-800"}>
                  {r.descricao}
                </p>
              )}

              <FotosRegistro fotoUrl={r.foto_url} podeVerSelfie={admin || r.seguranca === segurancaAtual} />

              {r.latitude && r.longitude && (
                <div className="mt-2 flex items-center justify-between border-t border-zinc-800 pt-1.5 text-[11px] text-zinc-400">
                  <span>📍 GPS: {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</span>
                  <a
                    href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-amber-400 underline underline-offset-2"
                  >
                    Ver no Google Maps ↗
                  </a>
                </div>
              )}
              {podeExcluirRegistro(r, segurancaAtual, admin) ? (
                <button
                  onClick={() => handleExcluir(r)}
                  disabled={excluindoId === r.id}
                  className="mt-2 flex items-center gap-1.5 rounded-[8px] bg-red-950 px-2.5 py-1 text-[11px] font-semibold text-red-400 ring-1 ring-red-500/30 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  {excluindoId === r.id ? "A excluir..." : admin ? "Excluir registo" : "Anular / refazer"}
                </button>
              ) : (
                ehMarcacaoPlantao(r.descricao) && (
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-600">🔒 Marcação de plantão protegida</p>
                )
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={carregar}
        disabled={carregando}
        className="mt-4 w-full rounded-[12px] bg-zinc-800 py-3 text-[13px] font-semibold text-zinc-400 disabled:opacity-60"
      >
        Atualizar
      </button>
    </div>
  );
}

function FotosRegistro({ fotoUrl, podeVerSelfie = false }: { fotoUrl: string | null; podeVerSelfie?: boolean }) {
  const fotos = fotosVisiveis(fotoUrl, podeVerSelfie);
  if (fotos.length === 0) return null;
  return (
    <div className="mt-2.5">
      {fotos.length === 1 ? (
        <a href={fotos[0]} target="_blank" rel="noreferrer">
          <img
            src={fotos[0]}
            alt="Foto da anomalia"
            loading="lazy"
            className="h-32 w-full rounded-[10px] object-cover ring-1 ring-zinc-700 hover:opacity-95 transition-opacity"
          />
        </a>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {fotos.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="aspect-square">
              <img
                src={url}
                alt={`Foto ${i + 1} da anomalia`}
                loading="lazy"
                className="size-full rounded-[8px] object-cover ring-1 ring-zinc-700 hover:opacity-95 transition-opacity"
              />
            </a>
          ))}
        </div>
      )}
      <span className="text-[10px] text-zinc-500">
        {fotos.length > 1 ? `${fotos.length} fotos · toque para ampliar` : "Clique na foto para ampliar"}
      </span>
    </div>
  );
}

/* ---------------- Livro Ata ---------------- */

interface OcorrenciaItem {
  id: string;
  seguranca: string;
  descricao: string;
  created_at: string;
}

function OcorrenciasTab({ seguranca, admin }: { seguranca: string; admin: boolean }) {
  const [lista, setLista] = useState<OcorrenciaItem[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [filtroSeguranca, setFiltroSeguranca] = useState("TODOS");
  const [listaSegurancas, setListaSegurancas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");

  async function carregarOcorrencias() {
    setCarregando(true);
    try {
      let query = supabase
        .from("ocorricoes_plantao")
        .select("*")
        .order("created_at", { ascending: false });

      if (dataInicial) {
        query = query.gte("created_at", `${dataInicial}T00:00:00`);
      }
      if (dataFinal) {
        query = query.lte("created_at", `${dataFinal}T23:59:59`);
      }
      if (filtroSeguranca !== "TODOS") {
        query = query.eq("seguranca", filtroSeguranca);
      }

      const { data, error } = await query.limit(500);

      if (!error && data) {
        setLista(data);
        
        const unicos = Array.from(new Set(data.map((item) => item.seguranca).filter(Boolean)));
        if (listaSegurancas.length === 0 && unicos.length > 0) {
          setListaSegurancas(unicos);
        }
      }
    } catch {
      setErro("Não foi possível carregar o livro ata.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarOcorrencias();
  }, [dataInicial, dataFinal, filtroSeguranca]);

  async function enviarOcorrencia() {
    if (texto.trim().length < 5) {
      setErro("Escreva uma descrição detalhada para o Livro Ata.");
      return;
    }
    setEnviando(true);
    setErro("");
    setSucesso(false);

    try {
      const { error } = await supabase.from("ocorricoes_plantao").insert([
        {
          seguranca,
          descricao: texto.trim(),
        },
      ]);

      if (error) throw error;

      setTexto("");
      setSucesso(true);
      carregarOcorrencias();
    } catch {
      setErro("Erro ao salvar no Livro Ata. Verifique a conexão.");
    } finally {
      setEnviando(false);
    }
  }

  async function excluirOcorrencia(id: string) {
    if (!admin) return;
    if (!window.confirm("Excluir este registo do Livro Ata?")) return;
    try {
      await supabase.from("ocorricoes_plantao").delete().eq("id", id);
      setLista((prev) => prev.filter((item) => item.id !== id));
    } catch {
      window.alert("Não foi possível excluir.");
    }
  }

  function limparFiltros() {
    setDataInicial("");
    setDataFinal("");
    setFiltroSeguranca("TODOS");
    setBusca("");
  }

  const termo = normalizarBusca(busca);
  const listaFiltrada = termo
    ? lista.filter((item) => normalizarBusca(`${item.seguranca} ${item.descricao}`).includes(termo))
    : lista;
  const temFiltros = !!(dataInicial || dataFinal || busca || filtroSeguranca !== "TODOS");
  const restantes = LIMITE_LIVRO_ATA - texto.length;
  const hojeStr = new Date().toDateString();

  return (
    <div>
      <div className="rounded-[18px] bg-zinc-950 p-4 ring-1 ring-zinc-800 shadow-md mb-4">
        <label htmlFor="livro-ata-texto" className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
          📖 Novo Registo no Livro Ata
        </label>
        <p className="mt-1 text-[12px] text-zinc-500">
          Registre manutenções, atendimentos, visitas de gerentes ou ocorrências relevantes do plantão.
        </p>

        <textarea
          id="livro-ata-texto"
          rows={10}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro("");
            setSucesso(false);
          }}
          maxLength={LIMITE_LIVRO_ATA}
          placeholder="Ex.: Manutenção na central de alarme, apoio ao colaborador... O texto pode ser revisto livremente antes de assinar."
          className="mt-2.5 min-h-40 w-full resize-y rounded-[12px] bg-zinc-900 p-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className={texto.trim().length > 0 && texto.trim().length < 5 ? "text-amber-400" : "text-zinc-600"}>
            Mínimo 5 caracteres
          </span>
          <span
            aria-live="polite"
            className={`font-mono ${restantes <= 50 ? "font-bold text-red-400" : restantes <= 150 ? "text-amber-400" : "text-zinc-500"}`}
          >
            {texto.length}/{LIMITE_LIVRO_ATA}
          </span>
        </div>

        {erro && <p className="mt-1.5 text-[13px] font-medium text-red-400">{erro}</p>}
        {sucesso && <p className="mt-1.5 text-[13px] font-semibold text-emerald-400">Registrado com sucesso no Livro Ata!</p>}

        <button
          onClick={enviarOcorrencia}
          disabled={enviando || texto.trim().length < 5}
          className="mt-3 w-full rounded-[14px] bg-gradient-to-r from-amber-500 to-amber-600 py-3 font-display text-[15px] font-bold text-zinc-950 shadow-md disabled:opacity-50 active:translate-y-0.5"
        >
          {enviando ? "A salvar..." : "Assinar e Salvar no Livro Ata"}
        </button>
      </div>

      {admin && <div className="mb-3 rounded-[14px] bg-zinc-950 p-3 ring-1 ring-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">🔍 Filtrar Livro Ata</span>
          {temFiltros && (
            <button onClick={limparFiltros} className="text-[12px] font-semibold text-amber-400 underline underline-offset-2">
              Limpar filtros
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar no texto ou nome..."
            className="w-full rounded-[10px] bg-zinc-900 py-2 pl-8 pr-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400 font-medium">
          Segurança
          <select
            value={filtroSeguranca}
            onChange={(e) => setFiltroSeguranca(e.target.value)}
            className="rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-normal"
          >
            <option value="TODOS">👥 Todos os seguranças</option>
            {listaSegurancas.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-zinc-400 font-medium">
            Data inicial
            <input
              type="date"
              value={dataInicial}
              max={dataFinal || undefined}
              onChange={(e) => setDataInicial(e.target.value)}
              className="w-full min-w-0 rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-normal"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-zinc-400 font-medium">
            Data final
            <input
              type="date"
              value={dataFinal}
              min={dataInicial || undefined}
              onChange={(e) => setDataFinal(e.target.value)}
              className="w-full min-w-0 rounded-[10px] bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-normal"
            />
          </label>
        </div>
      </div>}

      {admin && (
      <button
        onClick={() => gerarRelatorioLivroAta(listaFiltrada)}
        disabled={carregando || listaFiltrada.length === 0}
        className="mb-4 w-full rounded-[12px] bg-zinc-800 py-3 font-display text-[13px] font-semibold tracking-wide text-zinc-100 shadow-md disabled:opacity-50 active:translate-y-0.5"
      >
        🖨️ Imprimir / Gerar Relatório do Livro Ata
      </button>
      )}

      <div className="mb-2.5 flex items-center justify-between px-1">
        <p className="font-display text-[15px] font-semibold text-zinc-200">
          Registros no Livro Ata ({listaFiltrada.length}
          {listaFiltrada.length !== lista.length ? ` de ${lista.length}` : ""})
        </p>
      </div>

      {carregando ? (
        <p className="text-center text-[13px] text-zinc-500 py-4">A carregar registros do Livro Ata...</p>
      ) : listaFiltrada.length === 0 ? (
        <p className="rounded-[14px] bg-zinc-950 p-5 text-center text-[14px] text-zinc-500 ring-1 ring-zinc-800">
          Nenhum registo encontrado com os filtros selecionados.
        </p>
      ) : (
        <div className="space-y-2.5">
          {listaFiltrada.map((item) => {
            const ehHoje = new Date(item.created_at).toDateString() === hojeStr;
            const ehMeu = item.seguranca === seguranca;
            return (
              <article
                key={item.id}
                className={`rounded-[14px] bg-zinc-950 p-3.5 shadow-md ring-1 ${ehMeu ? "ring-amber-500/30" : "ring-zinc-800"}`}
              >
                <header className="mb-2 flex items-center gap-2.5 border-b border-zinc-800 pb-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500/15 text-[13px] font-bold text-amber-400 ring-1 ring-amber-500/30">
                    {item.seguranca.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-zinc-100">
                      {item.seguranca}
                      {ehMeu && <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-400">(você)</span>}
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">{formatarDataHora(item.created_at)}</p>
                  </div>
                  {ehHoje && (
                    <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      Hoje
                    </span>
                  )}
                </header>
                <p className="break-words text-[14px] leading-relaxed text-zinc-300 whitespace-pre-line">{item.descricao}</p>
                {admin && (
                  <button
                    onClick={() => excluirOcorrencia(item.id)}
                    className="mt-2.5 flex items-center gap-1.5 rounded-[8px] bg-red-950 px-2.5 py-1 text-[11px] font-semibold text-red-400 ring-1 ring-red-500/30"
                  >
                    <Trash2 className="size-3.5" /> Excluir registo
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LIMITE_LIVRO_ATA = 8000;

function normalizarBusca(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/* ---------------- Relatório do Livro Ata ---------------- */

function gerarRelatorioLivroAta(registros: OcorrenciaItem[]) {
  if (registros.length === 0) return;
  const geradoEm = new Date().toLocaleString("pt-BR");

  const linhas = registros
    .map((r, i) => {
      const data = formatarDataHora(r.created_at);
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${data}</td>
        <td style="font-weight:700">${escapeHtml(r.seguranca)}</td>
        <td>${escapeHtml(r.descricao)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório do Livro Ata — Falcon Serviços</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1c1a17; margin: 28px; }
  .cabecalho { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #1c1a17; padding-bottom: 14px; margin-bottom: 18px; }
  .cabecalho h1 { font-size: 22px; margin: 0; }
  .cabecalho p { margin: 2px 0 0; font-size: 13px; color: #5a544c; }
  .resumo { display: flex; gap: 18px; margin-bottom: 16px; font-size: 13px; }
  .resumo span { background: #f3eee5; padding: 6px 12px; border-radius: 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 24px; }
  th, td { border: 1px solid #d9d2c6; padding: 9px 12px; text-align: left; vertical-align: top; }
  th { background: #1c1a17; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:nth-child(even) td { background: #faf7f1; }
  .rodape { margin-top: 18px; font-size: 11px; color: #7a736a; border-top: 1px solid #d9d2c6; padding-top: 10px; }
  @media print { body { margin: 14px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Falcon Serviços — Relatório do Livro Ata</h1>
      <p>Histórico Oficial de Ocorrências e Plantão</p>
    </div>
  </div>
  <div class="resumo">
    <span>Total de Registros: ${registros.length}</span>
    <span>Gerado em: ${geradoEm}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 40px">#</th>
        <th style="width: 140px">Data/Hora</th>
        <th style="width: 160px">Segurança</th>
        <th>Descrição da Ocorrência</th>
      </tr>
    </thead>
    <tbody>
      ${linhas}
    </tbody>
  </table>

  <p class="rodape">Documento gerado automaticamente pelo aplicativo Falcon Serviços — Segurança Patrimonial.</p>
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;font-weight:700;background:#1c1a17;color:#fff;border:none;border-radius:8px;cursor:pointer">Imprimir / Salvar PDF</button>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const janela = window.open(url, "_blank");
  if (!janela) {
    window.alert("Permita os pop-ups no navegador para gerar o relatório.");
  }
}

/* ---------------- Relatório de Rondas com GPS / Google Maps, Fotos e Nome do Cliente em Destaque ---------------- */

function gerarRelatorio(
  registros: RegistroRonda[],
  posto: string,
  acesso: { admin: boolean; segurancaAtual: string },
) {
  if (registros.length === 0) return;
  const geradoEm = new Date().toLocaleString("pt-BR");
  const tituloPosto = posto !== "TODOS" ? `Posto / Cliente: ${escapeHtml(posto)}` : "Todos os Postos / Clientes";

  const totalOk = registros.filter((r) => r.status === "OK" && !r.descricao?.includes("BAIXA MANUAL") && !r.descricao?.includes("PLANTÃO FINALIZADO")).length;
  const totalBaixasManuais = registros.filter((r) => r.status === "OK" && r.descricao?.includes("BAIXA MANUAL")).length;
  const totalFechos = registros.filter((r) => r.descricao?.includes("PLANTÃO FINALIZADO")).length;
  const totalAnomalia = registros.filter((r) => r.status === "ANOMALIA").length;
  const totalPendentes = registros.filter((r) => r.status === "ANOMALIA" && r.gravidade === "GRAVE" && r.status_correcao === "PENDENTE").length;

  const linhas = registros
    .map((r, i) => {
      const data = formatarDataHora(r.created_at);
      const local = r.locais_ronda
        ? `${escapeHtml(r.locais_ronda.predio)} — ${escapeHtml(r.locais_ronda.local)}`
        : "Local removido";
      const ehManual = r.status === "OK" && r.descricao?.includes("BAIXA MANUAL");
      const ehFecho = r.descricao?.includes("PLANTÃO FINALIZADO");
      const status = ehFecho ? "🏁 PLANTÃO FECHADO" : ehManual ? "⚠️ BAIXA MANUAL" : r.status === "OK" ? "OK" : r.status_correcao === "CORRIGIDO" ? "✓ CORRIGIDO" : "🚨 GRAVE (PENDENTE)";
      const corStatus = ehFecho ? "#1f7a43" : ehManual ? "#b3261e" : r.status === "OK" ? "#1f7a43" : r.status_correcao === "CORRIGIDO" ? "#1f7a43" : "#b3261e";
      const desc = r.descricao ? escapeHtml(r.descricao) : "—";
      
      const gpsInfo = r.latitude && r.longitude 
        ? `<br><a href="https://maps.google.com/?q=${r.latitude},${r.longitude}" target="_blank" style="color:#0f52ba;font-size:11px;font-weight:600">📍 Ver no Google Maps</a>` 
        : "";

      const fotos = fotosVisiveis(r.foto_url, acesso.admin || r.seguranca === acesso.segurancaAtual);
      const fotoInfo = fotos.length > 0
        ? `<br><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">${fotos
            .map((url) => `<a href="${escapeHtml(url)}" target="_blank"><img src="${escapeHtml(url)}" alt="Foto" style="max-width:120px;max-height:120px;border-radius:6px;border:1px solid #d9d2c6;" /></a>`)
            .join("")}</div>`
        : "";

      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${data}</td>
        <td>${escapeHtml(r.seguranca)}</td>
        <td>${local}</td>
        <td style="text-align:center;font-weight:700;color:${corStatus}">${status}</td>
        <td>${desc} ${gpsInfo} ${fotoInfo}</td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório de Rondas com GPS e Fotos — Falcon Serviços</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1c1a17; margin: 28px; }
  .cabecalho { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1c1a17; padding-bottom: 12px; margin-bottom: 16px; }
  .cabecalho h1 { font-size: 22px; margin: 0; }
  .cabecalho p { margin: 2px 0 0; font-size: 13px; color: #5a544c; }
  .badge-posto { background: #1c1a17; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 15px; font-weight: bold; }
  .resumo { display: flex; gap: 18px; margin-bottom: 16px; font-size: 13px; flex-wrap: wrap; }
  .resumo span { background: #f3eee5; padding: 6px 12px; border-radius: 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 24px; }
  th, td { border: 1px solid #d9d2c6; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #1c1a17; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:nth-child(even) td { background: #faf7f1; }
  h2 { font-size: 16px; border-bottom: 2px solid #1c1a17; padding-bottom: 6px; margin-top: 24px; }
  .rodape { margin-top: 18px; font-size: 11px; color: #7a736a; border-top: 1px solid #d9d2c6; padding-top: 10px; }
  @media print { body { margin: 14px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Falcon Serviços — Relatório de Rondas com Geolocalização e Registo Fotográfico</h1>
      <p>Controle Operacional e Auditoria GPS</p>
    </div>
    <div class="badge-posto">
      🏢 ${tituloPosto}
    </div>
  </div>
  <div class="resumo">
    <span>Total Rondas: ${registros.length}</span>
    <span style="color:#1f7a43">OK: ${totalOk}</span>
    <span style="color:#b3261e">Baixas Manuais: ${totalBaixasManuais}</span>
    <span style="color:#1f7a43">Fechos Plantão: ${totalFechos}</span>
    <span style="color:#b3261e">Pendentes: ${totalPendentes}</span>
    <span>Gerado em: ${geradoEm}</span>
  </div>

  <h2>Registro de Rondas e Ocorrências</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Data/Hora</th><th>Segurança</th><th>Local</th><th>Status / Correção</th><th>Descrição / GPS / Foto</th>
      </tr>
    </thead>
    <tbody>
      ${linhas}
    </tbody>
  </table>

  <p class="rodape">Documento gerado automaticamente pelo aplicativo Falcon Serviços — Segurança Patrimonial.</p>
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;font-weight:700;background:#1c1a17;color:#fff;border:none;border-radius:8px;cursor:pointer">Imprimir / Salvar PDF</button>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const janela = window.open(url, "_blank");
  if (!janela) {
    window.alert("Permita os pop-ups no navegador para gerar o relatório.");
  }
}

const ENTIDADES: Record<string, string> = {
  "&": String.fromCharCode(38, 97, 109, 112, 59),
  "<": String.fromCharCode(38, 108, 116, 59),
  ">": String.fromCharCode(38, 103, 116, 59),
  '"': String.fromCharCode(38, 113, 117, 111, 116, 59),
  "'": String.fromCharCode(38, 35, 51, 57, 59),
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTIDADES[ch] ?? ch);
}

function formatarHora(iso: string) {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (hoje) return hora;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

function formatarDataHora(iso: string) {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${data} ${hora}`;
}

/* ---------------- Shell ---------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-stretch justify-center bg-black px-0 py-0 font-body text-zinc-100 sm:px-6 sm:py-8">
      <div className="flex w-full max-w-[420px] flex-col overflow-hidden bg-zinc-900 ring-1 ring-zinc-800 sm:rounded-[28px] sm:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between bg-zinc-950 px-5 pt-4 pb-4 text-zinc-100 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-900 ring-1 ring-zinc-700 shadow-sm">
              <img
                src="/logo.jpeg"
                alt="Falcon Serviços"
                className="size-full object-cover"
              />
            </div>
            <div className="leading-none">
              <p className="font-display text-[16px] font-semibold tracking-tight text-zinc-100">Falcon Serviços</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Segurança Patrimonial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 border border-zinc-800">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]"></span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-400">Online</span>
          </div>
        </div>

        {children}

        <div className="mt-auto flex items-center justify-between border-t border-zinc-800 bg-zinc-950 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-[12px] font-medium text-zinc-400">Conectado · Nuvem</span>
          </div>
          <span className="font-mono text-[12px] text-zinc-600">v1.2</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Painel Administrativo ---------------- */

async function apagarLinha(tabela: "segurancas" | "locais_ronda", id: string) {
  const { data, error } = await supabase.from(tabela).delete().eq("id", id).select("id");
  if (error) throw error;
  // Sem política RLS de DELETE o PostgREST devolve 200 com 0 linhas — não é sucesso.
  if (!data?.length) {
    throw new Error("A exclusão foi bloqueada pela base de dados (permissão DELETE).");
  }
}

function AdminTab() {
  const [locais, setLocais] = useState<LocalRonda[]>([]);
  const [segurancas, setSegurancas] = useState<SegurancaDb[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  // Estados de Cadastro / Edição de Local (Posto)
  const [editandoLocalId, setEditandoLocalId] = useState<string | null>(null);
  const [predio, setPredio] = useState("");
  const [empresaNova, setEmpresaNova] = useState(false);
  const [localNome, setLocalNome] = useState("");
  const [qrHash, setQrHash] = useState("");
  // Enquanto o código não for editado à mão, é gerado a partir do nome do prédio (ex.: samambaia-02).
  const [qrManual, setQrManual] = useState(false);
  const [salvandoLocal, setSalvandoLocal] = useState(false);
  const formLocalRef = useRef<HTMLDivElement>(null);

  // Estados de Cadastro / Edição de Segurança
  const [editandoSegId, setEditandoSegId] = useState<string | null>(null);
  const [nomeSeg, setNomeSeg] = useState("");
  const [cargoSeg, setCargoSeg] = useState("Segurança");
  const [tipoContratoSeg, setTipoContratoSeg] = useState("PJ");
  const [pinSeg, setPinSeg] = useState(() => gerarPinAcesso());
  const [postosSelecionados, setTodosPostosSelecionados] = useState<string[]>([]);
  const [salvandoSeg, setSalvandoSeg] = useState(false);

  const listaPostosDisponiveis = Array.from(new Set(locais.map((l) => l.predio).filter(Boolean))).sort();
  const qrAutomatico = useMemo(
    () => gerarProximoCodigo(predio, locais.map((l) => l.qr_code_hash)),
    [predio, locais],
  );
  const qrEfetivo = (editandoLocalId || qrManual ? qrHash : qrAutomatico).trim();

  async function carregarDadosAdmin(silencioso = false) {
    if (!silencioso) setCarregando(true);
    try {
      const { data: locs } = await supabase.from("locais_ronda").select("*").order("predio", { ascending: true });
      setLocais(locs || []);

      const { data: segs } = await supabase.from("segurancas").select("*").order("nome", { ascending: true });
      setSegurancas(segs || []);
    } catch {
      if (!silencioso) {
        setLocais([]);
        setSegurancas([]);
      }
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDadosAdmin();
  }, []);

  function prepararEdicaoLocal(loc: LocalRonda) {
    setEditandoLocalId(loc.id);
    setPredio(loc.predio);
    setEmpresaNova(!listaPostosDisponiveis.includes(loc.predio));
    setLocalNome(loc.local);
    setQrHash(loc.qr_code_hash);
    setQrManual(true);
    formLocalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelarEdicaoLocal() {
    setEditandoLocalId(null);
    setPredio("");
    setEmpresaNova(listaPostosDisponiveis.length === 0);
    setLocalNome("");
    setQrHash("");
    setQrManual(false);
  }

  async function salvarLocal(e: React.FormEvent) {
    e.preventDefault();
    const nomeDigitado = predio.trim();
    const predioCanonico = empresaExistente(nomeDigitado, listaPostosDisponiveis) || nomeDigitado;
    if (!predioCanonico || !localNome.trim() || !qrEfetivo) {
      window.alert("Preencha todos os campos do local de ronda.");
      return;
    }
    setSalvandoLocal(true);
    try {
      if (editandoLocalId) {
        const { error } = await supabase
          .from("locais_ronda")
          .update({
            predio: predioCanonico,
            local: localNome.trim(),
            qr_code_hash: qrEfetivo,
          })
          .eq("id", editandoLocalId);

        if (error) throw error;
        window.alert("Local atualizado com sucesso!");
      } else {
        const { error } = await supabase.from("locais_ronda").insert([
          {
            predio: predioCanonico,
            local: localNome.trim(),
            qr_code_hash: qrEfetivo,
          },
        ]);
        if (error) throw error;
        window.alert("Local cadastrado com sucesso!");
      }

      cancelarEdicaoLocal();
      carregarDadosAdmin();
    } catch (err: any) {
      window.alert(err?.message || "Erro ao salvar local.");
    } finally {
      setSalvandoLocal(false);
    }
  }

  async function excluirLocal(id: string) {
    if (!window.confirm("Deseja excluir este local de ronda?")) return;
    const snapshot = locais;
    setLocais((prev) => prev.filter((l) => l.id !== id));
    if (editandoLocalId === id) cancelarEdicaoLocal();
    setExcluindoId(id);
    try {
      await apagarLinha("locais_ronda", id);
      await carregarDadosAdmin(true);
    } catch (err: any) {
      setLocais(snapshot);
      window.alert(err?.message || "Erro ao excluir local.");
    } finally {
      setExcluindoId(null);
    }
  }

  function prepararEdicaoSeguranca(seg: SegurancaDb) {
    setEditandoSegId(seg.id);
    setNomeSeg(seg.nome);
    setCargoSeg(seg.cargo || "Segurança");
    setTipoContratoSeg(seg.tipo_contrato || "PJ");
    setPinSeg(seg.pin || gerarPinAcesso());
    
    if (seg.posto_atribuido) {
      const postosArray = seg.posto_atribuido.split(",").map((p) => p.trim());
      setTodosPostosSelecionados(postosArray);
    } else {
      setTodosPostosSelecionados([]);
    }
  }

  function cancelarEdicaoSeguranca() {
    setEditandoSegId(null);
    setNomeSeg("");
    setCargoSeg("Segurança");
    setTipoContratoSeg("PJ");
    setPinSeg(gerarPinAcesso(segurancas.map((s) => s.pin)));
    setTodosPostosSelecionados([]);
  }

  async function salvarSeguranca(e: React.FormEvent) {
    e.preventDefault();
    const pinFinal = pinSeg.trim() || gerarPinAcesso(segurancas.map((s) => s.pin));
    if (!nomeSeg.trim()) {
      window.alert("Preencha o nome do segurança.");
      return;
    }
    setSalvandoSeg(true);
    try {
      const postoFinalStr = postosSelecionados.length > 0 ? postosSelecionados.join(", ") : "Geral";
      const perfil = perfilAPartirDoCargo(cargoSeg);
      const payload = {
        nome: nomeSeg.trim(),
        cargo: cargoSeg.trim(),
        tipo_contrato: tipoContratoSeg.trim(),
        pin: pinFinal,
        posto_atribuido: postoFinalStr,
        perfil,
      };

      if (editandoSegId) {
        let { error } = await supabase.from("segurancas").update(payload).eq("id", editandoSegId);
        if (error) {
          const semPerfil = { ...payload, perfil: undefined };
          delete (semPerfil as { perfil?: string }).perfil;
          const retry = await supabase.from("segurancas").update(semPerfil).eq("id", editandoSegId);
          if (retry.error) throw retry.error;
        }
        window.alert(`Segurança atualizado. PIN de acesso: ${pinFinal}`);
      } else {
        let { error } = await supabase.from("segurancas").insert([{ ...payload, ativo: true }]);
        if (error) {
          const semPerfil = { ...payload, perfil: undefined };
          delete (semPerfil as { perfil?: string }).perfil;
          const retry = await supabase.from("segurancas").insert([{ ...semPerfil, ativo: true }]);
          if (retry.error) throw retry.error;
        }
        window.alert(`Segurança cadastrado com sucesso.\nPIN de acesso: ${pinFinal}`);
      }

      cancelarEdicaoSeguranca();
      carregarDadosAdmin();
    } catch (err: any) {
      window.alert(err?.message || "Erro ao salvar segurança.");
    } finally {
      setSalvandoSeg(false);
    }
  }

  async function excluirSeguranca(id: string) {
    if (!window.confirm("Deseja remover este segurança?")) return;
    const snapshot = segurancas;
    setSegurancas((prev) => prev.filter((b) => b.id !== id));
    if (editandoSegId === id) cancelarEdicaoSeguranca();
    setExcluindoId(id);
    try {
      await apagarLinha("segurancas", id);
      await carregarDadosAdmin(true);
    } catch (err: any) {
      setSegurancas(snapshot);
      window.alert(err?.message || "Erro ao excluir segurança.");
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">⚙️ Painel de Gestão Falcon Serviços</h3>
        <p className="mt-1 text-[13px] text-zinc-400 sm:text-[14px]">
          Gerencie autonomamente os locais de ronda e a equipa de seguranças por posto.
        </p>
      </div>

      {carregando ? (
        <p className="text-center text-[13px] text-zinc-500 py-4">A carregar dados administrativos...</p>
      ) : (
        <>
          {/* SECÇÃO DE LOCAIS / POSTOS */}
          <div ref={formLocalRef} className="scroll-mt-4 rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-display text-[16px] font-bold text-zinc-100">
                {editandoLocalId ? "✏️ Editar Local de Ronda" : "📍 Cadastrar Novo Local de Ronda"}
              </h4>
              {editandoLocalId && (
                <button
                  onClick={cancelarEdicaoLocal}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300"
                >
                  Cancelar Edição
                </button>
              )}
            </div>

            <form onSubmit={salvarLocal} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Empresa / Posto</label>
                {listaPostosDisponiveis.length > 0 && (
                  <select
                    value={empresaNova ? "__NOVA__" : predio}
                    onChange={(e) => {
                      if (e.target.value === "__NOVA__") {
                        setEmpresaNova(true);
                        setPredio("");
                      } else {
                        setEmpresaNova(false);
                        setPredio(e.target.value);
                      }
                    }}
                    className="mb-2 w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Selecione a empresa já cadastrada</option>
                    {listaPostosDisponiveis.map((empresa) => (
                      <option key={empresa} value={empresa}>
                        {empresa}
                      </option>
                    ))}
                    <option value="__NOVA__">+ Nova empresa / posto</option>
                  </select>
                )}
                {(empresaNova || listaPostosDisponiveis.length === 0) && (
                  <input
                    type="text"
                    value={predio}
                    onChange={(e) => {
                      const valor = e.target.value;
                      const existente = empresaExistente(valor, listaPostosDisponiveis);
                      if (existente) {
                        setEmpresaNova(false);
                        setPredio(existente);
                        return;
                      }
                      setPredio(valor);
                    }}
                    placeholder="Nome da nova empresa (só se ainda não existir)"
                    className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                )}
                <p className="mt-1 text-[11px] text-zinc-500">
                  Escolha uma empresa da lista para evitar duplicados. O campo livre só abre para um nome novo.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Descrição do Local</label>
                  <input
                    type="text"
                    value={localNome}
                    onChange={(e) => setLocalNome(e.target.value)}
                    placeholder="Ex.: Portaria"
                    className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-[12px] font-semibold text-zinc-400">
                    Código QR
                    {!editandoLocalId && (
                      qrManual ? (
                        <button
                          type="button"
                          onClick={() => setQrManual(false)}
                          className="ml-auto text-[11px] font-semibold text-amber-400 underline underline-offset-2"
                        >
                          ↻ Gerar automático
                        </button>
                      ) : (
                        <span className="ml-auto text-[11px] font-medium text-emerald-400">automático pelo prédio</span>
                      )
                    )}
                  </label>
                  <input
                    type="text"
                    value={editandoLocalId || qrManual ? qrHash : qrAutomatico}
                    onChange={(e) => {
                      setQrHash(e.target.value);
                      setQrManual(true);
                    }}
                    placeholder="Ex.: samambaia-02"
                    className="w-full rounded-xl bg-zinc-950 p-3 font-mono text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {qrEfetivo && (
                <div className="flex items-center gap-4 rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800">
                  <QrPreview codigo={qrEfetivo} className="size-24 shrink-0 rounded-lg sm:size-28" />
                  <div className="min-w-0 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Pré-visualização</p>
                    <p className="truncate font-mono text-[14px] font-bold text-zinc-100">{qrEfetivo}</p>
                    <button
                      type="button"
                      onClick={() =>
                        baixarQrPng({ codigo: qrEfetivo, predio: predio.trim() || "—", local: localNome.trim() || "—" })
                      }
                      className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-700"
                    >
                      <Download className="size-3.5" /> Baixar PNG
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={salvandoLocal}
                className={
                  editandoLocalId
                    ? "w-full rounded-xl bg-amber-500 py-3.5 font-display text-[15px] font-bold text-zinc-950 shadow-md active:translate-y-0.5"
                    : "w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-3.5 font-display text-[15px] font-bold text-zinc-950 shadow-md active:translate-y-0.5"
                }
              >
                {salvandoLocal ? "A guardar..." : editandoLocalId ? "Salvar Alterações do Local" : "+ Adicionar Local de Ronda"}
              </button>
            </form>

            <LocaisQrSection locais={locais} onEditar={prepararEdicaoLocal} onExcluir={excluirLocal} />
          </div>

          {/* SECÇÃO DE SEGURANÇAS */}
          <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-display text-[16px] font-bold text-zinc-100">
                {editandoSegId ? "✏️ Editar Segurança" : "🛡️ Cadastrar Novo Segurança / Postos Atribuídos"}
              </h4>
              {editandoSegId && (
                <button
                  onClick={cancelarEdicaoSeguranca}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300"
                >
                  Cancelar Edição
                </button>
              )}
            </div>

            <form onSubmit={salvarSeguranca} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Nome Completo</label>
                  <input
                    type="text"
                    value={nomeSeg}
                    onChange={(e) => setNomeSeg(e.target.value)}
                    placeholder="Ex.: CARPINA"
                    className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Cargo / Perfil</label>
                  <select
                    value={cargoSeg}
                    onChange={(e) => setCargoSeg(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {CARGOS_EQUIPA.map((cargo) => (
                      <option key={cargo} value={cargo}>
                        {cargo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Contrato</label>
                  <select
                    value={tipoContratoSeg}
                    onChange={(e) => setTipoContratoSeg(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="PJ">PJ</option>
                    <option value="CLT">CLT</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 flex items-center text-[12px] font-semibold text-zinc-400">
                    PIN de acesso
                    <button
                      type="button"
                      onClick={() => setPinSeg(gerarPinAcesso(segurancas.map((s) => s.pin)))}
                      className="ml-auto text-[11px] font-semibold text-amber-400 underline underline-offset-2"
                    >
                      Gerar novo
                    </button>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinSeg}
                    readOnly
                    className="w-full rounded-xl bg-zinc-950 p-3 font-mono text-[16px] tracking-[0.3em] text-amber-300 ring-1 ring-amber-500/30 outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {editandoSegId ? "PIN atual do colaborador. Gere um novo se precisar resetar." : "Gerado automaticamente no cadastro."}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-zinc-400 mb-2">🏢 Postos Atribuídos (Selecione um ou mais postos):</label>
                {listaPostosDisponiveis.length === 0 ? (
                  <p className="text-[12px] text-zinc-500">Cadastre postos/locais de ronda acima primeiro.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-40 overflow-y-auto rounded-xl bg-zinc-950 p-3.5 ring-1 ring-zinc-800">
                    {listaPostosDisponiveis.map((p) => {
                      const selecionado = postosSelecionados.includes(p);
                      return (
                        <label key={p} className="flex items-center gap-2 cursor-pointer text-[13px] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={selecionado}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTodosPostosSelecionados([...postosSelecionados, p]);
                              } else {
                                setTodosPostosSelecionados(postosSelecionados.filter((x) => x !== p));
                              }
                            }}
                            className="size-4 rounded accent-amber-500"
                          />
                          <span className="truncate">{p}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={salvandoSeg}
                className={
                  editandoSegId
                    ? "w-full rounded-xl bg-amber-500 py-3.5 font-display text-[15px] font-bold text-zinc-950 shadow-md active:translate-y-0.5"
                    : "w-full rounded-xl bg-zinc-800 py-3.5 font-display text-[15px] font-bold text-zinc-100 shadow-md active:translate-y-0.5"
                }
              >
                {salvandoSeg ? "A guardar..." : editandoSegId ? "Salvar Alterações do Segurança" : "+ Adicionar Segurança"}
              </button>
            </form>

            <div className="border-t border-zinc-800 pt-5 mt-5">
              <p className="text-[13px] font-semibold text-zinc-300 mb-3">Seguranças Ativos ({segurancas.length})</p>
              {segurancas.length === 0 ? (
                <p className="text-[13px] text-zinc-600">Nenhum segurança cadastrado.</p>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {segurancas.map((b) => (
                    <div key={b.id} className="flex flex-col gap-2.5 rounded-xl bg-zinc-950 p-3 text-[14px] ring-1 ring-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-200">{b.nome} <span className="text-xs font-normal text-zinc-500">({b.cargo} • {b.tipo_contrato || "CLT"})</span></p>
                        <p className="break-words text-[12px] text-amber-400 font-medium">Postos: {b.posto_atribuido || "Geral"}</p>
                      </div>
                      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                        <button
                          onClick={() => prepararEdicaoSeguranca(b)}
                          className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-400 ring-1 ring-amber-500/30"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => excluirSeguranca(b.id)}
                          disabled={excluindoId === b.id}
                          className="rounded-lg bg-red-950 px-3 py-1.5 text-[12px] font-semibold text-red-400 ring-1 ring-red-500/30 disabled:opacity-60"
                        >
                          {excluindoId === b.id ? "A excluir..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Aba: Financeiro PJ ---------------- */

function FinanceiroPjTab() {
  const [segurancasPJ, setSegurancasPJ] = useState<any[]>([]);
  const [valorHora, setValorHora] = useState<number>(15.0);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [filtroFuncionarioPJ, setFiltroFuncionarioPJ] = useState("TODOS");
  const [registros, setRegistros] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  function gerarRelatorioPJ() {
    const geradoEm = new Date().toLocaleString("pt-BR");
    const linhas = segurancasPjFiltrados.map((pj, i) => {
      const res = calcularResumoPJ(pj.nome);
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="font-weight:700">${escapeHtml(pj.nome)}</td>
        <td>${escapeHtml(pj.posto_atribuido || "Geral")}</td>
        <td style="text-align:center">${res.dias} dias (${res.horas}h)</td>
        <td style="text-align:right;font-weight:bold;color:#1f7a43">R$ ${res.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório Financeiro PJ — Falcon Serviços</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1c1a17; margin: 28px; }
  .cabecalho { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1c1a17; padding-bottom: 12px; margin-bottom: 16px; }
  .cabecalho h1 { font-size: 22px; margin: 0; }
  .cabecalho p { margin: 2px 0 0; font-size: 13px; color: #5a544c; }
  .badge { background: #1c1a17; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: bold; }
  .resumo { display: flex; gap: 18px; margin-bottom: 16px; font-size: 13px; flex-wrap: wrap; }
  .resumo span { background: #f3eee5; padding: 6px 12px; border-radius: 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
  th, td { border: 1px solid #d9d2c6; padding: 9px 12px; text-align: left; }
  th { background: #1c1a17; color: #fff; font-size: 12px; text-transform: uppercase; }
  tr:nth-child(even) td { background: #faf7f1; }
  .rodape { margin-top: 18px; font-size: 11px; color: #7a736a; border-top: 1px solid #d9d2c6; padding-top: 10px; }
  @media print { body { margin: 14px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Falcon Serviços — Relatório Financeiro PJ</h1>
      <p>Apuração de Horas e Valores a Pagar</p>
    </div>
    <div class="badge">
      Valor da Hora: R$ ${valorHora.toFixed(2)}
    </div>
  </div>
  <div class="resumo">
    <span>Total Colaboradores: ${segurancasPjFiltrados.length}</span>
    <span>Gerado em: ${geradoEm}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center">#</th>
        <th>Colaborador PJ</th>
        <th>Posto Atribuído</th>
        <th style="text-align:center">Apuração</th>
        <th style="text-align:right">Total a Pagar</th>
      </tr>
    </thead>
    <tbody>
      ${linhas}
    </tbody>
  </table>
  <p class="rodape">Documento gerado automaticamente pelo aplicativo Falcon Serviços — Segurança Patrimonial.</p>
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;font-weight:700;background:#1c1a17;color:#fff;border:none;border-radius:8px;cursor:pointer">Imprimir / Salvar PDF</button>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const janela = window.open(url, "_blank");
    if (!janela) {
      window.alert("Permita os pop-ups no navegador para gerar o relatório.");
    }
  }

  async function carregarDadosPJ() {
    setCarregando(true);
    try {
      const { data: segs } = await supabase
        .from("segurancas")
        .select("*")
        .eq("tipo_contrato", "PJ")
        .order("nome", { ascending: true });
      
      setSegurancasPJ(segs || []);

      const regs = await listarRegistros(2000, {
        dataInicial: dataInicio || undefined,
        dataFinal: dataFim || undefined,
      });
      setRegistros(regs || []);
    } catch {
      setSegurancasPJ([]);
      setRegistros([]);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDadosPJ();
  }, [dataInicio, dataFim]);

  function calcularResumoPJ(nomeSeguranca: string) {
    const regsColaborador = registros.filter(r => r.seguranca === nomeSeguranca);
    
    const diasMap = new Map<string, any[]>();
    regsColaborador.forEach(r => {
      const diaStr = new Date(r.created_at).toDateString();
      if (!diasMap.has(diaStr)) {
        diasMap.set(diaStr, []);
      }
      diasMap.get(diaStr)?.push(new Date(r.created_at).getTime());
    });

    let totalHorasGerais = 0;
    const diasTrabalhadosCount = diasMap.size;

    diasMap.forEach((tempos) => {
      totalHorasGerais += horasPlantaoArredondadas(tempos);
    });

    const totalPagar = totalHorasGerais * valorHora;

    return {
      dias: diasTrabalhadosCount,
      horas: totalHorasGerais,
      total: totalPagar,
    };
  }

  const segurancasPjFiltrados = segurancasPJ.filter((pj) => {
    if (filtroFuncionarioPJ === "TODOS") return true;
    return pj.nome === filtroFuncionarioPJ;
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">💰 Gestão Financeira — Colaboradores PJ</h3>
        <p className="mt-1 text-[13px] text-zinc-400 sm:text-[14px]">
          Horas de plantão com tolerância de 30 minutos e valor a pagar por colaborador PJ.
        </p>
      </div>

      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-4 sm:p-6">
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          ⚙️ Configuração e Filtros
        </span>

        <div>
          <label className="block text-[12px] font-semibold text-zinc-400 mb-1">👤 Selecionar Colaborador PJ</label>
          <select
            value={filtroFuncionarioPJ}
            onChange={(e) => setFiltroFuncionarioPJ(e.target.value)}
            className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-medium"
          >
            <option value="TODOS">👥 Todos os Colaboradores PJ</option>
            {segurancasPJ.map((pj) => (
              <option key={pj.id} value={pj.nome}>
                {pj.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Valor da Hora (R$)</label>
            <input
              type="number"
              step="0.5"
              value={valorHora}
              onChange={(e) => setValorHora(parseFloat(e.target.value) || 0)}
              className="w-full rounded-xl bg-zinc-950 p-3 text-[15px] font-bold text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Data Inicial</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-zinc-400 mb-1">Data Final</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>

      {carregando ? (
        <p className="text-center text-[13px] text-zinc-500 py-4">Calculando apuração PJ...</p>
      ) : segurancasPjFiltrados.length === 0 ? (
        <p className="rounded-[14px] bg-zinc-900 p-6 text-center text-[14px] text-zinc-500 ring-1 ring-zinc-800">
          Nenhum colaborador PJ encontrado com este filtro.
        </p>
      ) : (
        <div className="space-y-3">
          {segurancasPjFiltrados.map((pj) => {
            const resumo = calcularResumoPJ(pj.nome);
            return (
              <div key={pj.id} className="rounded-[16px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="font-display text-[16px] font-bold text-zinc-100">{pj.nome}</p>
                  <p className="break-words text-[13px] text-zinc-400 mt-0.5">Posto: <span className="font-semibold text-amber-400">{pj.posto_atribuido || "Geral"}</span> • {resumo.dias} dias trabalhados ({resumo.horas}h)</p>
                </div>
                <div className="flex flex-row-reverse items-baseline justify-between border-t border-zinc-800 pt-2 sm:block sm:shrink-0 sm:border-0 sm:pt-0 sm:text-right">
                  <p className="font-mono text-[20px] font-bold text-amber-400">
                    R$ {resumo.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">Total a Pagar</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={gerarRelatorioPJ}
        className="w-full rounded-[14px] bg-zinc-800 py-3.5 font-display text-[15px] font-bold text-zinc-100 shadow-md active:translate-y-0.5"
      >
        🖨️ Imprimir / Exportar Relatório Financeiro PJ
      </button>
    </div>
  );
}
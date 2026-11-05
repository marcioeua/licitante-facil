<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-xs">Análise de empresas</div>
    <div class="text-body2 text-grey-7 q-mb-md">Pesquise um concorrente (ou a sua empresa) pelo nome ou CNPJ e veja como ele vende para o governo.</div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-7">
          <q-select v-model="escolhida" :options="sugestoes" option-value="ni" option-label="nome" use-input hide-selected fill-input
            input-debounce="300" outlined dense clearable placeholder="Nome da empresa ou CNPJ" @filter="filtrar" @update:model-value="(v) => v && abrir(v.ni)">
            <template #prepend><q-icon name="search" /></template>
            <template #option="{ itemProps, opt }">
              <q-item v-bind="itemProps">
                <q-item-section><q-item-label>{{ opt.nome }}</q-item-label><q-item-label caption>CNPJ {{ cnpj(opt.ni) }}</q-item-label></q-item-section>
                <q-item-section side class="text-caption">{{ opt.contratos }} contrato(s)</q-item-section>
              </q-item>
            </template>
            <template #no-option><q-item><q-item-section class="text-grey-7">Digite pelo menos 3 letras ou números do CNPJ</q-item-section></q-item></template>
          </q-select>
        </div>
        <div class="col-12 col-md-5">
          <q-btn-toggle v-model="dias" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9"
            :options="[{ label: '90 dias', value: 90 }, { label: '6 meses', value: 182 }, { label: '12 meses', value: 365 }]" />
        </div>
        <div v-if="minhas.length" class="col-12 row items-center q-gutter-xs">
          <span class="text-caption text-grey-7 q-mr-xs">Minhas empresas:</span>
          <q-chip v-for="e in minhas" :key="e.id" clickable dense color="blue-1" text-color="primary" icon="business" @click="abrir(e.cnpj)">{{ e.razao_social }}</q-chip>
        </div>
      </q-card-section>
    </q-card>

    <!-- Comparação -->
    <q-card v-if="comparar.length" flat bordered class="lf-card q-mb-md">
      <q-card-section class="row items-center q-pb-sm">
        <div class="col text-subtitle1 text-weight-medium">Comparação</div>
        <q-btn flat dense no-caps color="grey-8" label="Limpar" @click="comparar = []; tabelaComparacao = []" />
      </q-card-section>
      <q-markup-table flat dense separator="horizontal">
        <thead><tr><th class="text-left">Empresa</th><th class="text-right">Valor</th><th class="text-right">Contratos</th><th class="text-right">Contrato médio</th><th class="text-right">Clientes</th><th class="text-right">Estados</th><th /></tr></thead>
        <tbody>
          <tr v-for="c in tabelaComparacao" :key="c.cnpj">
            <td class="text-left"><a href="#" class="text-primary" @click.prevent="abrir(c.cnpj)">{{ c.nome ?? cnpj(c.cnpj) }}</a></td>
            <td class="text-right">{{ brl(c.valor) }}</td><td class="text-right">{{ num(c.contratos) }}</td><td class="text-right">{{ brl(c.ticketMedio) }}</td>
            <td class="text-right">{{ num(c.clientes) }}</td><td class="text-right">{{ num(c.estados) }}</td>
            <td><q-btn flat round dense size="sm" icon="close" @click="removerComparacao(c.cnpj)" /></td>
          </tr>
        </tbody>
      </q-markup-table>
    </q-card>

    <div v-if="!p && !carregando" class="text-center text-grey-7 q-pa-xl">
      <q-icon name="manage_search" size="56px" /><br />Escolha uma empresa para ver a análise.
    </div>
    <q-skeleton v-if="carregando" height="320px" />

    <template v-if="p && !carregando">
      <!-- Cabeçalho -->
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row items-start q-col-gutter-md">
          <div class="col-12 col-md">
            <div class="text-h6 text-weight-bold">{{ p.cadastro?.razaoSocial ?? p.nome ?? 'Empresa' }}</div>
            <div v-if="p.cadastro?.nomeFantasia" class="text-body2 text-grey-8">{{ p.cadastro.nomeFantasia }}</div>
            <div class="text-caption text-grey-7">CNPJ {{ cnpj(p.cnpj) }}</div>
            <div v-if="p.cadastro" class="q-gutter-xs q-mt-sm">
              <q-badge v-if="p.cadastro.porte" color="blue-1" text-color="primary" :label="p.cadastro.porte" />
              <q-badge v-if="p.cadastro.simples" color="teal-1" text-color="teal-9" label="Simples Nacional" />
              <q-badge v-if="p.cadastro.mei" color="teal-1" text-color="teal-9" label="MEI" />
              <q-badge v-if="p.cadastro.situacao" :color="p.cadastro.situacao === 'ATIVA' ? 'green-1' : 'red-1'" :text-color="p.cadastro.situacao === 'ATIVA' ? 'green-9' : 'red-9'" :label="`Situação: ${p.cadastro.situacao}`" />
            </div>
            <div v-if="p.cadastro" class="text-body2 q-mt-sm">
              <div v-if="p.cadastro.atividade"><span class="text-grey-7">Atividade principal:</span> {{ p.cadastro.atividade }}</div>
              <div><span class="text-grey-7">Sede:</span> {{ p.cadastro.municipio }}/{{ p.cadastro.uf }}<span v-if="p.cadastro.abertura"> · aberta em {{ data(p.cadastro.abertura) }}</span>
                <span v-if="p.cadastro.capitalSocial"> · capital social {{ brl(p.cadastro.capitalSocial) }}</span></div>
            </div>
            <div v-else class="text-caption text-grey-6 q-mt-sm">Dados cadastrais da Receita indisponíveis no momento.</div>
          </div>
          <div class="col-12 col-md-auto q-gutter-sm">
            <q-btn outline no-caps color="primary" icon="compare_arrows" label="Comparar" :disable="comparar.includes(p.cnpj) || comparar.length >= 4" @click="adicionarComparacao(p.cnpj)" />
            <q-btn flat no-caps color="primary" icon="handshake" label="Contratos" :to="{ name: 'historico', query: { aba: 'contratos' } }" />
          </div>
        </q-card-section>
      </q-card>

      <!-- Números -->
      <div class="row q-col-gutter-md q-mb-md">
        <div v-for="k in kpis" :key="k.nome" class="col-6 col-md-2">
          <q-card flat bordered class="lf-card full-height"><q-card-section>
            <div class="text-caption text-grey-7">{{ k.nome }}</div>
            <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
          </q-card-section></q-card>
        </div>
      </div>
      <div class="text-caption text-grey-7 q-mb-md">
        <q-icon name="info" /> Valores de <b>contratos e empenhos assinados</b> publicados no PNCP<span v-if="p.periodo?.de"> desde {{ data(p.periodo.de) }}</span>.
        Não inclui disputas perdidas nem atas de registro de preço que ainda não viraram contrato, por isso pode ser menor que o "valor vencido" de outras ferramentas.
      </div>
      <div v-if="!p.resumo.contratos" class="text-grey-7 q-mb-md">Nenhum contrato desta empresa no período carregado.</div>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Vendas por mês</q-card-section>
            <q-card-section class="q-pt-none">
              <BarrasVerticais :itens="meses" :formatar="brlCurto" :altura="200" titulo="Vendas por mês" />
              <div class="text-caption text-grey-6 q-mt-sm">Barras listradas: meses em consolidação. Mostra a sazonalidade das vendas da empresa.</div>
            </q-card-section>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="row items-center q-pb-sm">
              <div class="col text-subtitle1 text-weight-medium">Principais clientes</div>
              <div v-if="pctRisco != null" class="text-caption" :class="pctRisco > 0.3 ? 'text-negative' : 'text-grey-7'">
                {{ pct(pctRisco) }} do valor vendido para órgãos com risco de atraso
              </div>
            </q-card-section>
            <q-list separator>
              <q-item v-for="c in p.clientes" :key="c.cnpj">
                <q-item-section>
                  <q-item-label>{{ c.nome }}</q-item-label>
                  <q-item-label caption>{{ c.municipio ? `${c.municipio}/` : '' }}{{ c.uf }} · {{ c.contratos }} contrato(s) · última {{ data(c.ultima) }}</q-item-label>
                </q-item-section>
                <q-item-section side class="items-end">
                  <div class="text-weight-medium text-dark">{{ brl(c.valor) }}</div>
                  <q-badge v-if="PAG[c.pagometro]" :color="PAG[c.pagometro].cor" :label="PAG[c.pagometro].nome" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>

          <q-card v-if="p.itens.length" flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Itens vencidos e preços</q-card-section>
            <q-markup-table flat dense>
              <thead><tr><th class="text-left">Item</th><th class="text-right">Preço unit.</th><th class="text-left">Unidade</th><th class="text-left">Comprador</th><th class="text-right">Data</th></tr></thead>
              <tbody>
                <tr v-for="(i, k) in p.itens" :key="k">
                  <td class="text-left" style="white-space: normal; max-width: 320px">{{ i.descricao }}</td>
                  <td class="text-right">{{ brl2(i.valor_unitario) }}</td><td class="text-left">{{ i.unidade }}</td>
                  <td class="text-left" style="white-space: normal">{{ i.orgao ?? '—' }}</td><td class="text-right">{{ data(i.data_resultado) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
            <div class="text-caption text-grey-6 q-pa-sm">Itens das compras já consultadas na pesquisa de preços.</div>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Contratos recentes</q-card-section>
            <q-list separator>
              <q-item v-for="c in p.recentes" :key="c.id">
                <q-item-section><q-item-label lines="2">{{ c.objeto }}</q-item-label><q-item-label caption>{{ c.orgao_nome }} · {{ c.municipio }}/{{ c.uf }}</q-item-label></q-item-section>
                <q-item-section side top class="text-right"><div class="text-weight-medium text-dark">{{ brl(c.valor_global) }}</div><div class="text-caption">{{ data(c.data_assinatura) }}</div></q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">O que vende</q-card-section>
            <q-card-section class="q-pt-none">
              <div v-if="!p.assuntos.length" class="text-grey-7">Sem dados suficientes.</div>
              <q-chip v-for="a in p.assuntos" :key="a.termo" clickable dense color="grey-2" text-color="grey-9"
                @click="$router.push({ name: 'mercado', query: { q: a.termo } })">
                {{ a.termo }} <span class="text-grey-6 q-ml-xs">{{ a.contratos }}</span>
                <q-tooltip>{{ a.contratos }} contrato(s) · {{ brl(a.valor) }} · clique para ver o mercado</q-tooltip>
              </q-chip>
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Onde vende</q-card-section>
            <q-card-section class="q-pt-none">
              <MapaBrasil :dados="Object.fromEntries(p.porUf.map((u) => [u.uf, u.valor]))" :formatar="brl" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Para quem vende (esfera)</q-card-section>
            <q-card-section class="q-pt-none">
              <BarraParticipacao :partes="p.porEsfera.map((e) => ({ chave: e.esfera, rotulo: e.nome, valor: e.valor }))" :cores="CORES_ESFERA" :formatar="brl" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Concorrentes diretos</q-card-section>
            <q-card-section class="q-pt-xs text-caption text-grey-7">Empresas que mais venderam para os mesmos clientes no período.</q-card-section>
            <q-list dense>
              <q-item v-for="c in p.concorrentes" :key="c.ni" clickable @click="abrir(c.ni)">
                <q-item-section><q-item-label lines="1">{{ c.nome }}</q-item-label><q-item-label caption>{{ c.clientesEmComum }} cliente(s) em comum · {{ brl(c.valor) }}</q-item-label></q-item-section>
                <q-item-section side><q-btn flat round dense size="sm" icon="compare_arrows" @click.stop="adicionarComparacao(c.ni)"><q-tooltip>Comparar</q-tooltip></q-btn></q-item-section>
              </q-item>
              <q-item v-if="!p.concorrentes.length"><q-item-section class="text-grey-7">Nenhum concorrente encontrado.</q-item-section></q-item>
            </q-list>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { brl, cnpj, data } from 'src/format';
import BarrasVerticais from 'components/graficos/BarrasVerticais.vue';
import MapaBrasil from 'components/graficos/MapaBrasil.vue';
import BarraParticipacao from 'components/graficos/BarraParticipacao.vue';

const CORES_ESFERA = { M: '#2a78d6', E: '#eb6834', F: '#1baf7a', D: '#eda100', N: '#6250d6' };
const PAG = { baixo: { cor: 'positive', nome: 'Paga em dia' }, medio: { cor: 'orange-8', nome: 'Atenção' }, alto: { cor: 'negative', nome: 'Risco de atraso' }, federal: { cor: 'primary', nome: 'Federal' } };
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const route = useRoute();
const router = useRouter();
const escolhida = ref(null);
const sugestoes = ref([]);
const minhas = ref([]);
const dias = ref(365);
const p = ref(null);
const carregando = ref(false);
const comparar = ref([]);
const tabelaComparacao = ref([]);

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const pct = (v) => `${((v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const brlCurto = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : brl(v));
const intervalo = () => ({ de: new Date(Date.now() - dias.value * 86400000).toISOString().slice(0, 10), ate: new Date().toISOString().slice(0, 10) });

const kpis = computed(() => [
  { nome: 'Contratado (assinado)', valor: brlCurto(p.value.resumo.valor) },
  { nome: 'Contratos', valor: num(p.value.resumo.contratos) },
  { nome: 'Contrato típico', valor: brlCurto(p.value.resumo.ticketMediano ?? 0) },
  { nome: 'Clientes', valor: num(p.value.resumo.clientes) },
  { nome: 'Estados', valor: num(p.value.resumo.estados) },
  { nome: 'Última venda', valor: p.value.resumo.ultima ? data(p.value.resumo.ultima) : '—' },
]);
const meses = computed(() => (p.value?.porMes ?? []).map((x) => ({
  rotulo: MESES[Number(x.mes.slice(5, 7)) - 1], rotuloLongo: `${MESES[Number(x.mes.slice(5, 7)) - 1]}/${x.mes.slice(0, 4)}`,
  valor: x.valor, detalhe: `${num(x.contratos)} contrato(s)`, parcial: x.consolidando,
})));
const pctRisco = computed(() => {
  const r = p.value?.riscoClientes ?? {};
  const total = Object.values(r).reduce((a, b) => a + b, 0);
  return total ? (r.alto ?? 0) / total : null;
});

function filtrar(texto, atualizar) {
  if (!texto || texto.length < 3) return atualizar(() => (sugestoes.value = []));
  api.get('/analise-empresas/sugestoes', { params: { q: texto } }).then(({ data: d }) => atualizar(() => (sugestoes.value = d)));
}
function abrir(ni) {
  router.replace({ name: 'analise-empresas', params: { cnpj: String(ni).replace(/\D/g, '') } });
}
async function carregar(ni) {
  if (!ni) { p.value = null; return; }
  carregando.value = true;
  try {
    p.value = (await api.get(`/analise-empresas/${ni}`, { params: intervalo(), timeout: 60000 })).data;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    carregando.value = false;
  }
}
async function atualizarComparacao() {
  tabelaComparacao.value = comparar.value.length ? (await api.get('/analise-empresas/comparar', { params: { cnpjs: comparar.value.join(','), ...intervalo() } })).data : [];
}
function adicionarComparacao(ni) {
  if (!comparar.value.includes(ni) && comparar.value.length < 4) comparar.value.push(ni);
  atualizarComparacao();
}
function removerComparacao(ni) {
  comparar.value = comparar.value.filter((x) => x !== ni);
  atualizarComparacao();
}

watch(() => route.params.cnpj, (c) => carregar(c));
watch(dias, () => { carregar(route.params.cnpj); atualizarComparacao(); });
onMounted(async () => {
  minhas.value = (await api.get('/empresas')).data;
  if (route.params.cnpj) carregar(route.params.cnpj);
});
</script>

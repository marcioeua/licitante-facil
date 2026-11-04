<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-xs">Análise de mercado</div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Tamanho do mercado, onde estão as compras, quem são os concorrentes e quanto cada um vende ao governo.
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-6">
          <q-input v-model="f.q" outlined dense clearable debounce="500" placeholder="Segmento. Ex.: material de limpeza, medicamentos, merenda escolar">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>
        <div class="col-12 col-md-4">
          <q-select v-model="f.uf" :options="filtros.ufs" multiple use-chips outlined dense clearable label="Estados (vazio = Brasil)" />
        </div>
        <div class="col-12 col-md-2">
          <q-btn-toggle v-model="medida" spread no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9"
            :options="[{ label: 'Valor', value: 'valor' }, { label: 'Contratos', value: 'contratos' }]" />
        </div>
      </q-card-section>
    </q-card>

    <div v-if="carregando && !m" class="row q-col-gutter-md"><div v-for="i in 4" :key="i" class="col-6 col-md-3"><q-skeleton height="90px" /></div></div>

    <template v-if="m">
      <div v-if="!m.periodo?.dias" class="text-grey-7 q-pa-md">Os contratos ainda estão sendo carregados do PNCP. Volte em algumas horas.</div>

      <!-- Indicadores -->
      <div class="row q-col-gutter-md q-mb-md">
        <div v-for="k in kpis" :key="k.nome" class="col-6 col-md">
          <q-card flat bordered class="lf-card full-height">
            <q-card-section>
              <div class="text-caption text-grey-7">{{ k.nome }}</div>
              <div class="text-h5 text-weight-bold">{{ k.valor }}</div>
              <div v-if="k.sub" class="text-caption text-grey-6">{{ k.sub }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <q-banner v-if="m.contratoDominante" class="bg-orange-1 lf-card q-mb-md">
        <template #avatar><q-icon name="info" color="orange-9" /></template>
        Um único contrato ({{ brl(m.contratoDominante.valor) }}, de {{ m.contratoDominante.fornecedor }}) representa
        {{ pct(m.contratoDominante.participacao) }} do valor. Para comparar concorrentes, veja também a visão por <b>número de contratos</b>.
      </q-banner>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">
              {{ medida === 'valor' ? 'Valor contratado' : 'Contratos' }} por semana
            </q-card-section>
            <q-card-section class="q-pt-none">
              <BarrasVerticais :itens="semanas" :formatar="fmt" titulo="Evolução semanal" />
              <div class="text-caption text-grey-6 q-mt-sm">Pela data de publicação no PNCP. Período: {{ data(m.periodo?.de) }} a {{ data(m.periodo?.ate) }}.</div>
            </q-card-section>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="row items-center q-pb-sm">
              <div class="col text-subtitle1 text-weight-medium">Quem mais vende</div>
              <q-badge v-if="conc" :color="CONC[conc.nivel]?.cor" :label="`Concentração ${CONC[conc.nivel]?.nome}`" />
            </q-card-section>
            <q-card-section class="q-pt-none">
              <div v-if="conc" class="text-body2 text-grey-8 q-mb-sm">
                Os 5 maiores têm <b>{{ pct(conc.top5) }}</b> do mercado {{ medida === 'valor' ? 'em valor' : 'em número de contratos' }}.
                {{ CONC[conc.nivel]?.texto }}
              </div>
              <BarrasHorizontais :itens="fornecedores" :formatar="(v) => pct(v)" :limite="10" clicavel titulo="Participação dos fornecedores" @escolher="abrirEmpresa" />
              <div class="text-caption text-grey-6 q-mt-xs">Clique em uma empresa para ver o perfil dela.</div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Quem compra (esfera)</q-card-section>
            <q-card-section class="q-pt-none">
              <BarraParticipacao :partes="esferas" :cores="CORES_ESFERA" :formatar="fmt" titulo="Participação por esfera" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Onde estão as compras</q-card-section>
            <q-card-section class="q-pt-none">
              <BarrasHorizontais :itens="ufs" :formatar="fmt" :limite="10" clicavel titulo="Por estado" @escolher="(it) => (f.uf = [it.chave])" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Maiores compradores</q-card-section>
            <q-list dense>
              <q-item v-for="o in m.compradores" :key="o.cnpj">
                <q-item-section><q-item-label lines="2">{{ o.nome }}</q-item-label><q-item-label caption>{{ o.uf }} · {{ o.contratos }} contrato(s)</q-item-label></q-item-section>
                <q-item-section side class="text-caption">{{ brl(o.valor) }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>
      </div>

      <q-expansion-item class="q-mt-md lf-card bg-white" icon="table_view" label="Ver os dados em tabela">
        <q-table flat :rows="m.fornecedores" :columns="colunas" row-key="ni" :pagination="{ rowsPerPage: 15 }" />
      </q-expansion-item>
    </template>

    <!-- Perfil da empresa -->
    <q-dialog v-model="dialogo" maximized-on-mobile>
      <q-card style="width: 860px; max-width: 95vw">
        <q-card-section class="row items-center">
          <div class="col">
            <div class="text-h6">{{ empresa?.nome ?? 'Empresa' }}</div>
            <div class="text-caption text-grey-7">CNPJ {{ cnpj(empresa?.ni) }}<span v-if="f.q"> · segmento "{{ f.q }}"</span></div>
          </div>
          <q-btn flat round icon="close" v-close-popup />
        </q-card-section>
        <q-card-section v-if="!empresa" class="q-pt-none"><q-skeleton height="200px" /></q-card-section>
        <template v-else>
          <q-card-section class="q-pt-none row q-col-gutter-md">
            <div v-for="k in kpisEmpresa" :key="k.nome" class="col-6 col-sm-3">
              <div class="text-caption text-grey-7">{{ k.nome }}</div>
              <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <div class="text-subtitle2 q-mb-sm">Onde vende</div>
              <BarrasHorizontais :itens="empresa.porUf.map((u) => ({ chave: u.uf, rotulo: u.uf, valor: u.valor, sub: `${u.contratos} contrato(s)` }))" :formatar="brl" :limite="6" />
            </div>
            <div class="col-12 col-md-6">
              <div class="text-subtitle2 q-mb-sm">Principais clientes</div>
              <q-list dense>
                <q-item v-for="o in empresa.clientes.slice(0, 6)" :key="o.cnpj">
                  <q-item-section><q-item-label lines="1">{{ o.nome }}</q-item-label><q-item-label caption>{{ o.uf }} · {{ o.contratos }} contrato(s)</q-item-label></q-item-section>
                  <q-item-section side class="text-caption">{{ brl(o.valor) }}</q-item-section>
                </q-item>
              </q-list>
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <div class="text-subtitle2 q-mb-sm">Contratos recentes</div>
            <q-list bordered separator class="lf-card">
              <q-item v-for="c in empresa.recentes" :key="c.id">
                <q-item-section><q-item-label lines="2">{{ c.objeto }}</q-item-label><q-item-label caption>{{ c.orgao_nome }} · {{ c.municipio }}/{{ c.uf }}</q-item-label></q-item-section>
                <q-item-section side top class="text-right"><div class="text-weight-medium text-dark">{{ brl(c.valor_global) }}</div><div class="text-caption">{{ data(c.data_assinatura) }}</div></q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps color="primary" icon="handshake" label="Ver todos os contratos" :to="{ name: 'historico', query: { aba: 'contratos' } }" />
          </q-card-actions>
        </template>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { brl, cnpj, data } from 'src/format';
import BarrasVerticais from 'components/graficos/BarrasVerticais.vue';
import BarrasHorizontais from 'components/graficos/BarrasHorizontais.vue';
import BarraParticipacao from 'components/graficos/BarraParticipacao.vue';

// Cor fixa por esfera (validada para daltonismo); a cor segue a categoria, não a posição.
const CORES_ESFERA = { M: '#2a78d6', E: '#eb6834', F: '#1baf7a', D: '#eda100', N: '#6250d6' };
const CONC = {
  alta: { nome: 'alta', cor: 'negative', texto: 'Poucas empresas dominam: entrar exige preço muito competitivo ou um diferencial.' },
  media: { nome: 'média', cor: 'orange-8', texto: 'Há líderes, mas espaço para novos fornecedores.' },
  baixa: { nome: 'baixa', cor: 'positive', texto: 'Mercado pulverizado: boa oportunidade para novos fornecedores.' },
};

const route = useRoute();
const filtros = useFiltros();
const f = reactive({ q: route.query.q ?? '', uf: route.query.uf ? String(route.query.uf).split(',') : [] });
const medida = ref('valor');
const m = ref(null);
const carregando = ref(false);
const dialogo = ref(false);
const empresa = ref(null);

const pct = (v) => `${((v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const brlCurto = (v) => (v >= 1e9 ? `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  : v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : brl(v));
const fmt = (v) => (medida.value === 'valor' ? brlCurto(v) : num(Math.round(v)));

const kpis = computed(() => [
  { nome: 'Valor contratado', valor: brlCurto(m.value.resumo.valor) },
  { nome: 'Contratos', valor: num(m.value.resumo.contratos) },
  { nome: 'Contrato típico (mediana)', valor: brlCurto(m.value.resumo.ticketMediano ?? 0), sub: `média ${brlCurto(m.value.resumo.ticketMedio)}` },
  { nome: 'Fornecedores', valor: num(m.value.resumo.fornecedores) },
  { nome: 'Órgãos compradores', valor: num(m.value.resumo.compradores) },
]);
const semanas = computed(() => (m.value?.porSemana ?? []).map((s) => ({
  rotulo: data(s.semana).slice(0, 5), rotuloLongo: `Semana de ${data(s.semana)}`,
  valor: medida.value === 'valor' ? s.valor : s.contratos,
  detalhe: medida.value === 'valor' ? `${num(s.contratos)} contrato(s)` : brl(s.valor),
})));
const conc = computed(() => (m.value ? (medida.value === 'valor' ? m.value.concentracao.porValor : m.value.concentracao.porContratos) : null));
const fornecedores = computed(() => {
  const lista = medida.value === 'valor' ? m.value.fornecedores : m.value.fornecedoresPorContratos;
  return lista.map((x) => ({
    chave: x.ni, rotulo: x.nome, valor: medida.value === 'valor' ? x.participacao : x.participacaoContratos,
    sub: `${num(x.contratos)} contrato(s) · ${brl(x.valor)} · ${x.clientes} cliente(s) em ${x.ufs} UF`,
  }));
});
const ufs = computed(() => (m.value?.porUf ?? [])
  .map((u) => ({ chave: u.uf, rotulo: u.uf, valor: medida.value === 'valor' ? u.valor : u.contratos, sub: medida.value === 'valor' ? `${num(u.contratos)} contrato(s)` : brl(u.valor) }))
  .sort((a, b) => b.valor - a.valor));
const esferas = computed(() => (m.value?.porEsfera ?? []).map((e) => ({ chave: e.esfera, rotulo: e.nome, valor: medida.value === 'valor' ? e.valor : e.contratos })));
const colunas = [
  { name: 'nome', label: 'Fornecedor', field: 'nome', align: 'left' },
  { name: 'ni', label: 'CNPJ', field: 'ni', format: cnpj, align: 'left' },
  { name: 'contratos', label: 'Contratos', field: 'contratos', sortable: true },
  { name: 'valor', label: 'Valor', field: 'valor', format: brl, sortable: true },
  { name: 'participacao', label: 'Participação (valor)', field: 'participacao', format: pct, sortable: true },
  { name: 'clientes', label: 'Clientes', field: 'clientes', sortable: true },
];
const kpisEmpresa = computed(() => [
  { nome: 'Valor contratado', valor: brlCurto(empresa.value.resumo.valor) },
  { nome: 'Contratos', valor: num(empresa.value.resumo.contratos) },
  { nome: 'Clientes', valor: num(empresa.value.resumo.compradores) },
  { nome: 'Fatia do segmento', valor: empresa.value.participacaoNoMercado != null ? pct(empresa.value.participacaoNoMercado) : '—' },
]);

async function carregar() {
  carregando.value = true;
  try {
    m.value = (await api.get('/mercado', { params: { q: f.q || undefined, uf: f.uf.join(',') || undefined } })).data;
  } finally {
    carregando.value = false;
  }
}
async function abrirEmpresa(it) {
  empresa.value = null;
  dialogo.value = true;
  empresa.value = (await api.get(`/mercado/empresa/${it.chave}`, { params: { q: f.q || undefined, uf: f.uf.join(',') || undefined } })).data;
}

watch(() => [f.q, f.uf], carregar, { deep: true });
onMounted(async () => {
  await filtros.carregar();
  carregar();
  if (route.query.empresa) abrirEmpresa({ chave: route.query.empresa });
});
</script>

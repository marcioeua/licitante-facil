<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="manage_search" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Busca por item</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Procure o produto dentro dos itens das licitações: quem está comprando, quanto, a situação do item e quem venceu.
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-5">
          <q-input v-model="q" outlined dense clearable placeholder="Ex.: ventilador, papel A4, detergente" @keyup.enter="buscar(1)" @clear="dados = null">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>
        <div class="col-6 col-md-2"><q-select v-model="uf" :options="UFS" outlined dense clearable label="Estado" @update:model-value="buscarSeTiver" /></div>
        <div class="col-6 col-md-3">
          <q-select v-model="situacao" :options="SITUACOES" emit-value map-options outlined dense label="Situação" @update:model-value="buscarSeTiver" />
        </div>
        <div class="col-12 col-md-2"><q-btn unelevated no-caps color="primary" icon="search" label="Buscar" class="full-width" :loading="carregando" @click="buscar(1)" /></div>
      </q-card-section>
    </q-card>

    <div v-if="dados" class="row items-center q-mb-sm">
      <div class="col text-body2 text-grey-7">{{ num(dados.total) }} resultado(s)</div>
      <q-btn-toggle v-model="ordem" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9" @update:model-value="buscar(1)"
        :options="[{ label: 'Mais recentes', value: 'data' }, { label: 'Maior valor', value: 'valor' }]" />
    </div>
    <div v-if="erro" class="text-grey-7 q-pa-md">{{ erro }}</div>
    <div v-if="dados && !dados.itens.length && !carregando" class="text-grey-7 q-pa-lg text-center">
      Nenhum item encontrado. Tente uma palavra mais curta (ex.: "ventilad") ou mude a situação para "Todas".
    </div>

    <q-card v-for="i in dados?.itens ?? []" :key="`${i.compra}-${i.item}`" flat bordered class="lf-card q-mb-md item-card">
      <q-card-section class="q-pb-sm">
        <div class="row items-start no-wrap q-gutter-x-sm">
          <div class="col text-caption text-grey-7 origem">
            <span class="text-weight-bold text-primary">{{ i.portal || 'Portal não identificado' }}</span>
            <span v-if="i.orgao"> · {{ i.orgao }}</span>
            <span v-if="i.modalidade"> · {{ i.modalidade }}<span v-if="i.numero"> Nº {{ i.numero }}/{{ i.ano }}</span></span>
            <q-badge v-if="i.uf" rounded color="blue-1" text-color="blue-9" class="q-ml-sm" :label="UF_NOME[i.uf] || i.uf" />
          </div>
          <q-badge :color="cor(i).bg" :text-color="cor(i).txt" class="text-weight-bold situacao" :label="rotulo(i)" />
        </div>
        <div class="text-subtitle1 text-weight-bold text-primary q-mt-xs titulo">Item {{ i.item }} — {{ i.descricao }}</div>
        <div v-if="i.objeto" class="text-body2 text-grey-8 q-mt-xs">{{ i.objeto }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="caixa row q-col-gutter-sm">
          <div class="col-6 col-sm-3"><div class="rot">Abertura</div><div class="val">{{ i.abertura ? dataHora(i.abertura) : '—' }}</div></div>
          <div class="col-6 col-sm-3"><div class="rot">Quantidade</div><div class="val">{{ num(i.quantidade) }}</div></div>
          <div class="col-6 col-sm-3"><div class="rot">Unidade</div><div class="val">{{ i.unidade || '—' }}</div></div>
          <div class="col-6 col-sm-3"><div class="rot">Valor estimado (unit.)</div><div class="val">{{ i.valorEstimado ? brl2(i.valorEstimado) : 'Sigiloso / não informado' }}</div></div>
        </div>
        <div v-if="i.fornecedorNi" class="caixa vencedor q-mt-sm">
          <div class="row items-center q-col-gutter-sm">
            <div class="col-12 col-sm">
              <div class="rot">Vencedor</div>
              <div class="text-weight-medium">{{ cnpj(i.fornecedorNi) }}<span v-if="i.fornecedorNome"> — {{ i.fornecedorNome }}</span></div>
              <div v-if="i.marca" class="text-caption">Marca: <b>{{ i.marca }}</b></div>
            </div>
            <div class="col-6 col-sm-auto"><div class="rot">Valor homologado (unit.)</div><div class="val text-positive">{{ brl2(i.valorResultado) }}</div></div>
            <div v-if="i.valorEstimado && i.valorResultado" class="col-6 col-sm-auto"><div class="rot">Abaixo do estimado</div><div class="val">{{ pct(1 - i.valorResultado / i.valorEstimado) }}</div></div>
          </div>
        </div>
        <div class="row items-center q-gutter-sm q-mt-xs">
          <span v-if="i.beneficio && /ME\/EPP/.test(i.beneficio)" class="text-caption text-teal-8"><q-icon name="verified" /> {{ i.beneficio }}</span>
          <q-space />
          <q-btn v-if="i.oportunidadeId" flat dense no-caps size="sm" color="primary" icon="visibility" label="Ver licitação" :to="{ name: 'oportunidade', params: { id: i.oportunidadeId } }" />
          <q-btn v-if="i.fornecedorNi" flat dense no-caps size="sm" color="primary" icon="query_stats" label="Analisar vencedor" :to="{ name: 'analise-empresas', params: { cnpj: i.fornecedorNi } }" />
          <q-btn v-if="i.linkPncp" flat dense no-caps size="sm" color="primary" icon="open_in_new" label="Ver no PNCP" :href="i.linkPncp" target="_blank" rel="noopener" />
          <q-btn v-if="i.linkOrigem" flat dense no-caps size="sm" color="primary" icon="launch" :label="`Abrir no ${i.portal || 'portal'}`" :href="i.linkOrigem" target="_blank" rel="noopener" />
        </div>
      </q-card-section>
    </q-card>

    <div v-if="dados && dados.total > dados.tamanho" class="row justify-center q-mt-md">
      <q-pagination v-model="pagina" :max="Math.ceil(dados.total / dados.tamanho)" :max-pages="7" direction-links boundary-numbers @update:model-value="buscar" />
    </div>
    <div class="text-caption text-grey-6 q-mt-md">
      Fontes: itens das licitações nos Dados Abertos do Compras.gov.br (chegam com cerca de 10 dias de atraso, com situação e vencedor)
      e itens das licitações abertas de todos os portais pelo PNCP. A base é montada aos poucos, todo dia<span v-if="dados?.periodo?.desde">; hoje cobre desde {{ data(dados.periodo.desde) }}</span>.
      Situações como "aceito e habilitado" ficam só dentro do portal da disputa e não são publicadas nos dados abertos.
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { cnpj, data, dataHora } from 'src/format';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
const SITUACOES = [
  { label: 'Todas', value: null },
  { label: 'Abertas para proposta', value: 'abertas' },
  { label: 'Em andamento', value: 'andamento' },
  { label: 'Homologadas (com vencedor)', value: 'homologados' },
  { label: 'Deserto / fracassado / cancelado', value: 'sem_sucesso' },
];
const route = useRoute();
const router = useRouter();
const q = ref(String(route.query.q ?? ''));
const uf = ref(route.query.uf ?? null);
const situacao = ref(route.query.situacao ?? null);
const ordem = ref('data');
const pagina = ref(1);
const dados = ref(null);
const carregando = ref(false);
const erro = ref('');
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const pct = (v) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));

function aberta(i) {
  return i.situacao === 'Em andamento' && i.encerramento && new Date(`${i.encerramento.slice(0, 19)}-03:00`) > new Date();
}
function rotulo(i) {
  if (aberta(i)) return 'ABERTA PARA PROPOSTA';
  return String(i.situacao ?? 'Sem situação').toUpperCase();
}
function cor(i) {
  if (aberta(i)) return { bg: 'blue-1', txt: 'blue-9' };
  if (i.situacao === 'Homologado') return { bg: 'green-1', txt: 'green-9' };
  if (/Deserto|Fracassado|Cancelado|Revogado|Anulado/i.test(i.situacao ?? '')) return { bg: 'red-1', txt: 'red-9' };
  return { bg: 'grey-3', txt: 'grey-9' };
}
function buscarSeTiver() { if (q.value?.trim()) buscar(1); }
async function buscar(p = pagina.value) {
  if (!q.value || q.value.trim().length < 3) { erro.value = 'Digite pelo menos 3 letras.'; return; }
  erro.value = '';
  pagina.value = p;
  carregando.value = true;
  router.replace({ query: { q: q.value, uf: uf.value || undefined, situacao: situacao.value || undefined } });
  try {
    dados.value = (await api.get('/itens', { params: { q: q.value, uf: uf.value || undefined, situacao: situacao.value || undefined, ordem: ordem.value, pagina: p }, timeout: 60000 })).data;
    if (p > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    carregando.value = false;
  }
}
onMounted(() => { if (q.value) buscar(1); });
</script>

<style scoped>
.item-card:hover { box-shadow: 0 0 0 2px rgba(29, 78, 216, 0.5); }
.origem { text-transform: uppercase; letter-spacing: .02em; }
.titulo { line-height: 1.35; }
.situacao { white-space: nowrap; padding: 4px 8px; }
.caixa { border-radius: 8px; padding: 8px 12px; background: rgba(100, 116, 139, 0.1); margin: 0; }
.vencedor { background: rgba(34, 197, 94, 0.1); }
.rot { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
.val { font-weight: 700; }
</style>

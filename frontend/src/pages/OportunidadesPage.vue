<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 text-weight-bold col-12 col-sm">Oportunidades</div>
      <div v-if="filtros.ultimaSincronizacao" class="text-caption text-grey-7 col-12 col-sm-auto">
        Atualizado do PNCP em {{ dataHora(filtros.ultimaSincronizacao.finalizado_em.replace(' ', 'T') + 'Z') }}
      </div>
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-5">
          <q-input v-model="f.q" outlined dense clearable debounce="400" placeholder="O que você vende? Ex.: notebook, limpeza, medicamentos">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
          <div class="text-caption q-mt-xs"><router-link :to="{ name: 'itens', query: f.q ? { q: f.q } : {} }" class="text-primary">Procurar dentro dos itens das licitações →</router-link></div>
        </div>
        <div class="col-6 col-md-2">
          <q-select v-model="f.uf" :options="filtros.ufs" multiple outlined dense label="UF" options-dense use-chips emit-value />
        </div>
        <div class="col-6 col-md-3">
          <q-select v-model="f.modalidade" :options="filtros.modalidades" option-value="id" option-label="nome" emit-value map-options
            multiple outlined dense label="Modalidade" options-dense :display-value="f.modalidade.length ? `${f.modalidade.length} selecionada(s)` : ''" />
        </div>
        <div class="col-12 col-md-4">
          <CidadesSelect v-model="f.municipio" :ufs="f.uf" dense label="Cidades" />
        </div>
        <div class="col-12 col-md-2">
          <q-select v-model="f.ordem" :options="ordens" emit-value map-options outlined dense label="Ordenar por" />
        </div>
        <div class="col-6 col-md-2"><q-input v-model.number="f.valorMin" type="number" outlined dense label="Valor mín. (R$)" debounce="500" /></div>
        <div class="col-6 col-md-2"><q-input v-model.number="f.valorMax" type="number" outlined dense label="Valor máx. (R$)" debounce="500" /></div>
        <div class="col-6 col-md-2">
          <q-select v-model="f.dataTipo" :options="tiposData" emit-value map-options outlined dense label="Filtrar pela data de" />
        </div>
        <div class="col-6 col-md-3">
          <q-input :model-value="periodoTexto" outlined dense readonly label="Período" placeholder="Qualquer data" class="cursor-pointer">
            <template #prepend><q-icon name="event" class="cursor-pointer" /></template>
            <template #append><q-icon v-if="f.dataDe || f.dataAte" name="close" class="cursor-pointer" @click.stop="limparPeriodo" /></template>
            <q-popup-proxy cover transition-show="scale" transition-hide="scale">
              <q-card>
                <q-card-section class="q-pb-none row q-gutter-xs">
                  <q-btn v-for="a in atalhos" :key="a.nome" dense outline no-caps size="sm" color="primary" :label="a.nome" @click="aplicarAtalho(a)" v-close-popup />
                </q-card-section>
                <q-date v-model="periodo" range mask="YYYY-MM-DD" minimal flat :locale="LOCALE_PT" />
                <q-card-actions align="right">
                  <q-btn flat no-caps label="Limpar" color="grey-8" @click="limparPeriodo" v-close-popup />
                  <q-btn unelevated no-caps label="Aplicar" color="primary" @click="aplicarPeriodo" v-close-popup />
                </q-card-actions>
              </q-card>
            </q-popup-proxy>
          </q-input>
        </div>
        <div class="col-auto"><q-toggle v-model="f.srp" label="Só registro de preço" /></div>
        <div class="col-auto"><q-btn flat no-caps icon="notifications_active" color="primary" label="Salvar como alerta" :disable="!f.q" @click="salvarAlerta" /></div>
      </q-card-section>
    </q-card>

    <div class="text-body2 text-grey-8 q-mb-sm">
      <q-spinner v-if="carregando" size="16px" class="q-mr-xs" />
      {{ resultado.total.toLocaleString('pt-BR') }} licitação(ões) com propostas abertas
    </div>

    <div v-if="!carregando && !resultado.itens.length" class="text-center q-pa-xl text-grey-7">
      <q-icon name="search_off" size="48px" /><br />
      Nenhuma licitação encontrada. Tente outras palavras ou remova filtros.
      <div v-if="!filtros.ultimaSincronizacao" class="q-mt-sm">
        A base ainda está vazia: rode <code>npm run sync</code> no backend para importar do PNCP.
      </div>
    </div>
    <div class="q-gutter-y-md">
      <OportunidadeCard v-for="op in resultado.itens" :key="op.id" :op="op" />
    </div>
    <div class="flex flex-center q-mt-lg" v-if="paginas > 1">
      <q-pagination v-model="f.pagina" :max="paginas" :max-pages="7" direction-links boundary-links />
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { dataHora } from 'src/format';
import OportunidadeCard from 'components/OportunidadeCard.vue';
import CidadesSelect from 'components/CidadesSelect.vue';

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const filtros = useFiltros();
const lista = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const f = reactive({
  q: route.query.q ?? '',
  uf: lista(route.query.uf),
  municipio: lista(route.query.municipio),
  modalidade: lista(route.query.modalidade).map(Number),
  valorMin: route.query.valorMin ?? null,
  valorMax: route.query.valorMax ?? null,
  srp: route.query.srp === 'true',
  ordem: route.query.ordem ?? 'encerramento',
  dataTipo: route.query.dataTipo ?? 'encerramento',
  dataDe: route.query.dataDe ?? null,
  dataAte: route.query.dataAte ?? null,
  pagina: Number(route.query.pagina) || 1,
});
const ordens = [
  { label: 'Prazo mais próximo', value: 'encerramento' },
  { label: 'Mais recentes', value: 'publicacao' },
  { label: 'Maior valor', value: 'valor' },
  { label: 'Relevância', value: 'relevancia' },
];
const tiposData = [
  { label: 'Prazo das propostas', value: 'encerramento' },
  { label: 'Abertura das propostas', value: 'abertura' },
  { label: 'Publicação', value: 'publicacao' },
];
const LOCALE_PT = {
  days: 'Domingo_Segunda_Terça_Quarta_Quinta_Sexta_Sábado'.split('_'), daysShort: 'Dom_Seg_Ter_Qua_Qui_Sex_Sáb'.split('_'),
  months: 'Janeiro_Fevereiro_Março_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro'.split('_'),
  monthsShort: 'Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez'.split('_'), firstDayOfWeek: 0,
};
const periodo = ref(f.dataDe ? { from: f.dataDe, to: f.dataAte ?? f.dataDe } : null);
const br = (d) => (d ? d.split('-').reverse().join('/') : '');
const periodoTexto = computed(() => {
  if (!f.dataDe && !f.dataAte) return '';
  if (f.dataDe === f.dataAte) return br(f.dataDe);
  if (!f.dataAte) return `a partir de ${br(f.dataDe)}`;
  if (!f.dataDe) return `até ${br(f.dataAte)}`;
  return `${br(f.dataDe)} a ${br(f.dataAte)}`;
});
// Datas de hoje no horário de Brasília.
const diaBr = (somaDias = 0) => new Date(Date.now() - 3 * 3600000 + somaDias * 86400000).toISOString().slice(0, 10);
const atalhos = [
  { nome: 'Hoje', de: 0, ate: 0 },
  { nome: 'Amanhã', de: 1, ate: 1 },
  { nome: 'Próximos 7 dias', de: 0, ate: 7 },
  { nome: 'Próximos 30 dias', de: 0, ate: 30 },
  { nome: 'Últimos 7 dias', de: -7, ate: 0 },
];
function aplicarAtalho(a) {
  f.dataDe = diaBr(a.de);
  f.dataAte = diaBr(a.ate);
  periodo.value = { from: f.dataDe, to: f.dataAte };
}
function aplicarPeriodo() {
  const v = periodo.value;
  if (!v) return limparPeriodo();
  if (typeof v === 'string') { f.dataDe = v; f.dataAte = v; } else { f.dataDe = v.from; f.dataAte = v.to; }
}
function limparPeriodo() {
  periodo.value = null;
  f.dataDe = null;
  f.dataAte = null;
}
const resultado = ref({ total: 0, itens: [], tamanho: 20 });
const carregando = ref(false);
const paginas = computed(() => Math.ceil(resultado.value.total / resultado.value.tamanho));

function params() {
  const p = { ...f, uf: f.uf.join(','), municipio: f.municipio.join(','), modalidade: f.modalidade.join(','),
    dataTipo: f.dataDe || f.dataAte ? f.dataTipo : null };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== null && v !== false));
}

async function buscar() {
  carregando.value = true;
  try {
    const p = params();
    router.replace({ query: p });
    resultado.value = (await api.get('/oportunidades', { params: p })).data;
  } finally {
    carregando.value = false;
  }
}

watch(() => [f.q, f.uf, f.municipio, f.modalidade, f.valorMin, f.valorMax, f.srp, f.ordem, f.dataTipo, f.dataDe, f.dataAte], () => {
  if (f.pagina !== 1) f.pagina = 1;
  else buscar();
}, { deep: true });
watch(() => f.pagina, buscar);

function salvarAlerta() {
  $q.dialog({ title: 'Novo alerta', message: 'Nome do alerta', prompt: { model: f.q, type: 'text' }, cancel: true })
    .onOk(async (nome) => {
      await api.post('/alertas', {
        nome: nome || f.q, palavras: f.q, ufs: f.uf, municipios: f.municipio, modalidades: f.modalidade,
        valor_min: f.valorMin || null, valor_max: f.valorMax || null,
      });
      $q.notify({ type: 'positive', message: 'Alerta criado. Você receberá as novidades por e-mail.' });
    });
}

onMounted(async () => {
  await filtros.carregar();
  buscar();
});
</script>

<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Voltar" class="q-mb-sm" @click="$router.back()" />
    <q-skeleton v-if="!op" height="300px" />
    <q-card v-else flat bordered class="lf-card">
      <q-card-section>
        <div class="row q-gutter-xs q-mb-sm">
          <q-badge color="blue-1" text-color="primary" :label="op.modalidade" />
          <q-badge v-if="op.situacao" color="grey-3" text-color="grey-9" :label="op.situacao" />
          <q-badge v-if="op.registro_preco" color="teal-1" text-color="teal-9" label="Registro de preço" />
        </div>
        <div class="text-h6 text-objeto">{{ op.objeto }}</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="row q-col-gutter-md">
          <div v-for="c in campos" :key="c.nome" class="col-12 col-sm-6 col-md-4">
            <div class="text-caption text-grey-7">{{ c.nome }}</div>
            <router-link v-if="c.to && c.valor" :to="c.to" class="text-body1 text-primary">{{ c.valor }}</router-link>
            <div v-else class="text-body1">{{ c.valor || '—' }}</div>
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-actions class="q-pa-md q-gutter-sm">
        <q-btn v-if="op.negocio_id" unelevated no-caps color="positive" icon="view_kanban" label="Abrir no funil" :to="{ name: 'negocio', params: { id: op.negocio_id } }" />
        <q-btn v-else-if="encerrada" unelevated no-caps color="grey-5" icon="block" label="Propostas encerradas" disable><q-tooltip>O prazo para enviar propostas já terminou</q-tooltip></q-btn>
        <q-btn v-else unelevated no-caps color="primary" icon="add" label="Adicionar ao funil" :loading="salvando" @click="adicionar" />
        <q-btn flat no-caps color="primary" icon="query_stats" label="Quem já vendeu isso?" :to="{ name: 'historico', query: { aba: 'contratos', q: termoHistorico } }" />
        <q-btn v-if="op.link_pncp" outline no-caps color="primary" icon="open_in_new" label="Ver edital no PNCP" :href="op.link_pncp" target="_blank" rel="noopener" />
        <q-btn v-if="canais.telegram" outline no-caps color="light-blue-8" icon="send" label="Enviar edital no meu Telegram" :loading="enviando === 'telegram'" @click="enviarCelular('telegram')" />
        <q-btn v-if="canais.whatsapp" outline no-caps color="positive" icon="chat" label="Enviar edital no meu WhatsApp" :loading="enviando === 'whatsapp'" @click="enviarCelular('whatsapp')" />
        <q-btn v-if="op.link_origem" flat no-caps color="primary" icon="launch" label="Sistema de origem" :href="op.link_origem" target="_blank" rel="noopener" />
      </q-card-actions>
    </q-card>
    <PagometroCard v-if="op" :key="`p${op.id}`" :oportunidade-id="op.id" class="q-mt-md" />
    <EditalIA v-if="op" id="edital-ia" :key="op.id" :oportunidade-id="op.id" :negocio-id="op.negocio_id" class="q-mt-md" />
  </q-page>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { Notify } from 'quasar';
import { brl, cnpj, dataHora } from 'src/format';
import EditalIA from 'components/EditalIA.vue';
import PagometroCard from 'components/PagometroCard.vue';

const route = useRoute();
const router = useRouter();
const op = ref(null);
const encerrada = computed(() => !!op.value && (!op.value.data_encerramento || new Date(op.value.data_encerramento) < new Date()));
const salvando = ref(false);
const enviando = ref('');
const canais = ref({ telegram: false, whatsapp: false });
const NOME_CANAL = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
async function enviarCelular(canal) {
  enviando.value = canal;
  try {
    const r = (await api.post(`/${canal}/edital/${route.params.id}`, {}, { timeout: 180000 })).data;
    Notify.create({ type: 'positive', message: r.documento ? `Edital enviado no seu ${NOME_CANAL[canal]}.` : 'O edital não está em PDF no PNCP: enviamos o aviso com o link.' });
  } finally {
    enviando.value = '';
  }
}
// Mostra os botões só dos canais ativos.
Promise.all([api.get('/telegram', { silencioso: true }), api.get('/whatsapp', { silencioso: true })])
  .then(([t, w]) => { canais.value = { telegram: t.data.ativo, whatsapp: w.data.ativo && w.data.servidor }; })
  .catch(() => {});
// Palavras principais do objeto para buscar no histórico (sem "aquisição", "contratação" etc.).
const PARADAS = new Set(['aquisicao', 'contratacao', 'registro', 'precos', 'futura', 'eventual', 'empresa', 'para', 'fornecimento', 'servicos', 'especializada', 'prestacao', 'atender', 'secretaria', 'municipal', 'conforme']);
const termoHistorico = computed(() => (op.value?.objeto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .match(/[a-z]{4,}/g)?.filter((w) => !PARADAS.has(w)).slice(0, 3).join(' ') ?? '');
const campos = computed(() => [
  { nome: 'Órgão', valor: op.value.orgao_nome, to: op.value.orgao_cnpj ? { name: 'orgao', params: { cnpj: op.value.orgao_cnpj } } : null },
  { nome: 'CNPJ do órgão', valor: cnpj(op.value.orgao_cnpj) },
  { nome: 'Unidade', valor: op.value.unidade_nome },
  { nome: 'Local', valor: [op.value.municipio, op.value.uf].filter(Boolean).join(' / ') },
  { nome: 'Número da compra', valor: [op.value.numero_compra, op.value.ano_compra].filter(Boolean).join('/') },
  { nome: 'Modo de disputa', valor: op.value.modo_disputa },
  { nome: 'Valor estimado', valor: brl(op.value.valor_estimado) },
  { nome: 'Publicação', valor: dataHora(op.value.data_publicacao) },
  { nome: 'Início das propostas', valor: dataHora(op.value.data_abertura) },
  { nome: 'Fim das propostas', valor: dataHora(op.value.data_encerramento) },
  { nome: 'Nº de controle PNCP', valor: op.value.numero_controle_pncp },
]);

async function adicionar() {
  salvando.value = true;
  try {
    const { data } = await api.post('/negocios', { oportunidade_id: op.value.id });
    router.push({ name: 'negocio', params: { id: data.id } });
  } finally {
    salvando.value = false;
  }
}

async function carregarOp() {
  op.value = null;
  op.value = (await api.get(`/oportunidades/${route.params.id}`)).data;
  // Veio do aviso "Edital lido": rola até o resumo do edital.
  if (route.query.ver === 'edital') {
    await nextTick();
    // Repete depois que os quadros terminam de carregar (a altura da página muda).
    for (const ms of [300, 1200, 2500]) setTimeout(() => document.getElementById('edital-ia')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), ms);
  }
}
onMounted(carregarOp);
watch(() => [route.params.id, route.query.ver], ([id]) => { if (id && route.name === 'oportunidade') carregarOp(); });
</script>

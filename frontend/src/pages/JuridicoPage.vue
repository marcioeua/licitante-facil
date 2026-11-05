<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="balance" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Peças jurídicas</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      A IA lê o edital, aponta possíveis irregularidades e redige pedidos de esclarecimento, impugnações, recursos e contrarrazões.
    </div>
    <q-banner dense rounded class="bg-amber-1 text-amber-10 q-mb-md">
      <template #avatar><q-icon name="gavel" /></template>
      São <b>rascunhos</b> feitos por IA: revise com um <b>advogado</b> antes de protocolar. A IA não cita jurisprudência por número; onde couber, deixa um marcador para o advogado completar.
    </q-banner>

    <q-select v-model="negocioId" :options="negocios" option-value="id" :option-label="(n) => n.titulo" emit-value map-options outlined dense
      label="Escolha o negócio (licitação)" class="q-mb-md" style="max-width: 720px" @update:model-value="carregar">
      <template #option="{ itemProps, opt }">
        <q-item v-bind="itemProps"><q-item-section><q-item-label lines="1">{{ opt.titulo }}</q-item-label><q-item-label caption>{{ opt.orgao_nome || 'Sem licitação do PNCP' }}{{ opt.uf ? ` · ${opt.uf}` : '' }}</q-item-label></q-item-section></q-item>
      </template>
      <template #no-option><q-item><q-item-section class="text-grey-7">Adicione licitações ao funil em Oportunidades.</q-item-section></q-item></template>
    </q-select>

    <div v-if="!negocioId" class="text-grey-7 q-pa-lg">Escolha um negócio para começar.</div>
    <q-skeleton v-else-if="!info" height="300px" />
    <div v-else class="row q-col-gutter-md">
      <div class="col-12 col-md-5">
        <q-card flat bordered class="lf-card q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold">{{ info.negocio.titulo }}</div>
            <div v-if="info.negocio.orgao_nome" class="text-body2 text-grey-7">{{ info.negocio.orgao_nome }} · {{ info.negocio.modalidade }} {{ info.negocio.numero_compra }}/{{ info.negocio.ano_compra }}</div>
            <div v-if="info.negocio.data_sessao" class="text-body2 q-mt-xs">Sessão de disputa: <b>{{ dataHora(info.negocio.data_sessao) }}</b></div>
            <div v-if="info.negocio.prazo_impugnacao" class="text-body2" :class="prazoPassou ? 'text-negative' : ''">
              Impugnação/esclarecimento até <b>{{ data(info.negocio.prazo_impugnacao) }}</b> (3 dias úteis antes, art. 164; confira feriados)
              <span v-if="prazoPassou"> · prazo encerrado</span>
            </div>
            <div class="text-body2 q-mt-xs">
              Empresa: <b v-if="info.negocio.empresa">{{ info.negocio.empresa }}</b>
              <span v-else class="text-negative">não escolhida. Escolha no negócio para a peça sair com os dados certos.</span>
            </div>
          </q-card-section>
          <q-separator />
          <q-card-section>
            <div class="text-subtitle2 text-weight-bold">1. Análise do edital</div>
            <div class="text-body2 text-grey-7 q-mb-sm">A IA procura cláusulas restritivas, exigências excessivas, contradições e omissões.</div>
            <q-btn unelevated no-caps color="primary" icon="policy" label="Analisar o edital" :loading="gerando === 'analise'" :disable="!!gerando || !info.iaDisponivel || !info.negocio.oportunidade_id" @click="analisar" />
            <div v-if="!info.negocio.oportunidade_id" class="text-caption text-grey-7 q-mt-xs">Este negócio não tem licitação do PNCP ligada.</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="q-gutter-y-sm">
            <div class="text-subtitle2 text-weight-bold">2. Nova peça</div>
            <q-btn-toggle v-model="form.tipo" spread no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9"
              :options="[{ label: 'Esclarecimento', value: 'esclarecimento' }, { label: 'Impugnação', value: 'impugnacao' }, { label: 'Recurso', value: 'recurso' }, { label: 'Contrarrazões', value: 'contrarrazoes' }]" />
            <q-input v-if="['recurso', 'contrarrazoes'].includes(form.tipo)" v-model="form.decisao" type="textarea" outlined autogrow :input-style="{ minHeight: '110px' }"
              :label="form.tipo === 'recurso' ? 'Cole a decisão que quer contestar (ata, mensagens do pregoeiro, julgamento)' : 'Cole as razões do recurso do concorrente'" />
            <q-input v-model="form.fatos" type="textarea" outlined autogrow :input-style="{ minHeight: '90px' }" :label="ROTULO_FATOS[form.tipo]" />
            <div class="row q-col-gutter-sm">
              <div class="col-12 col-sm-4"><q-input v-model="form.item" outlined dense label="Item/lote (opcional)" /></div>
              <div class="col-12 col-sm-8"><q-input v-model="form.representante" outlined dense label="Representante legal (opcional)" /></div>
              <div class="col-12"><q-input v-model="form.cidade" outlined dense label="Cidade/UF para assinatura (opcional)" /></div>
            </div>
            <q-btn unelevated no-caps color="primary" icon="edit_document" :label="`Redigir ${NOMES[form.tipo].toLowerCase()}`" :loading="gerando === 'peca'" :disable="!!gerando || !info.iaDisponivel" @click="redigir" />
            <div class="text-caption text-grey-6">Leva de 1 a 3 minutos. Conta no limite diário de análises com IA.</div>
            <div v-if="!info.iaDisponivel" class="text-caption text-negative">A IA não está ligada no servidor.</div>
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-7">
        <div v-if="gerando" class="row items-center q-gutter-sm text-grey-7 q-pa-md"><q-spinner-dots color="primary" size="28px" /><span>{{ gerando === 'analise' ? 'A IA está lendo o edital...' : 'A IA está redigindo a peça...' }}</span></div>
        <div v-if="!info.pecas.length && !gerando" class="text-grey-7 q-pa-md">Nenhuma peça ainda para este negócio.</div>

        <q-card v-for="p in info.pecas" :key="p.id" flat bordered class="lf-card q-mb-md">
          <q-card-section class="row items-start no-wrap q-pb-sm">
            <div class="col">
              <q-badge :color="COR[p.tipo]" :label="NOMES[p.tipo]" />
              <span class="text-caption text-grey-7 q-ml-sm">{{ quando(p.atualizado_em) }}</span>
            </div>
            <q-btn flat round dense size="sm" icon="delete_outline" color="grey-6" @click="apagar(p)"><q-tooltip>Apagar</q-tooltip></q-btn>
          </q-card-section>

          <template v-if="p.tipo === 'analise'">
            <q-card-section class="q-pt-none text-body2">{{ p.conteudo.resumo }}</q-card-section>
            <q-card-section v-if="!p.conteudo.pontos.length" class="q-pt-none text-grey-7">Nenhuma irregularidade evidente encontrada.</q-card-section>
            <q-list separator class="q-px-sm">
              <q-item v-for="(pt, k) in p.conteudo.pontos" :key="k" class="q-py-md">
                <q-item-section>
                  <div class="row items-center q-gutter-x-sm">
                    <q-badge :color="{ alta: 'negative', media: 'orange-8', baixa: 'grey-6' }[pt.gravidade]" :label="`Gravidade ${pt.gravidade === 'media' ? 'média' : pt.gravidade}`" />
                    <span class="text-weight-bold">{{ pt.titulo }}</span>
                  </div>
                  <div class="text-caption text-grey-7 q-mt-xs">{{ pt.onde }}</div>
                  <div class="text-body2 text-italic q-mt-xs">“{{ pt.trecho }}”</div>
                  <div class="text-body2 q-mt-xs">{{ pt.problema }}</div>
                  <div class="text-caption text-grey-8 q-mt-xs"><b>Fundamento:</b> {{ pt.fundamento }}</div>
                  <div v-if="pt.sugestao !== 'observar'" class="q-mt-sm">
                    <q-btn outline dense no-caps size="sm" color="primary" icon="edit_document"
                      :label="pt.sugestao === 'impugnacao' ? 'Redigir impugnação deste ponto' : 'Pedir esclarecimento deste ponto'" @click="usarPonto(pt)" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
            <q-card-section v-if="p.conteudo.ambiguidades.length" class="text-body2">
              <div class="text-caption text-weight-bold text-grey-8">PONTOS CONFUSOS (pedir esclarecimento)</div>
              <ul class="q-my-xs q-pl-md"><li v-for="(a, k) in p.conteudo.ambiguidades" :key="k">{{ a }}</li></ul>
            </q-card-section>
          </template>

          <template v-else>
            <q-card-section class="q-pt-none">
              <div class="peca-previa" v-html="markdownParaHtml(p.conteudo.slice(0, 900))" />
              <div v-if="p.dados.aviso" class="text-caption text-orange-9 q-mt-xs">{{ p.dados.aviso }}</div>
            </q-card-section>
            <q-card-actions>
              <q-btn flat no-caps color="primary" icon="open_in_full" label="Abrir e editar" @click="abrir(p)" />
              <q-btn flat no-caps color="primary" icon="content_copy" label="Copiar" @click="copiar(p)" />
              <q-btn flat no-caps color="primary" icon="download" label="Baixar Word" @click="baixarWord(p.titulo, p.conteudo)" />
            </q-card-actions>
          </template>
        </q-card>
      </div>
    </div>

    <q-dialog v-model="dlg" maximized>
      <q-card v-if="aberta" class="column no-wrap">
        <q-toolbar class="bg-primary text-white">
          <q-toolbar-title class="text-subtitle1">{{ aberta.titulo }}</q-toolbar-title>
          <q-btn flat no-caps icon="download" label="Baixar Word" @click="baixarWord(aberta.titulo, texto)" />
          <q-btn flat round icon="close" v-close-popup />
        </q-toolbar>
        <q-tabs v-model="aba" dense align="left" class="text-primary"><q-tab name="ver" label="Visualizar" /><q-tab name="editar" label="Editar texto" /></q-tabs>
        <q-separator />
        <div class="col scroll q-pa-md">
          <div v-if="aba === 'ver'" class="peca-doc" v-html="markdownParaHtml(texto)" />
          <q-input v-else v-model="texto" type="textarea" outlined autogrow :input-style="{ fontFamily: 'monospace', fontSize: '13px' }" />
        </div>
        <q-card-actions align="right" class="bg-grey-1">
          <span class="text-caption text-grey-7 q-mr-md">Use ## para títulos e **texto** para negrito.</span>
          <q-btn unelevated no-caps color="primary" label="Salvar alterações" :disable="texto === aberta.conteudo" :loading="salvando" @click="salvarTexto" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar, copyToClipboard, Notify } from 'quasar';
import { api } from 'boot/axios';
import { data, dataHora } from 'src/format';
import { markdownParaHtml, baixarWord } from 'components/markdown.js';

const NOMES = { analise: 'Análise do edital', esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', recurso: 'Recurso', contrarrazoes: 'Contrarrazões' };
const COR = { analise: 'deep-purple-6', esclarecimento: 'blue-7', impugnacao: 'negative', recurso: 'orange-9', contrarrazoes: 'teal-7' };
const ROTULO_FATOS = {
  esclarecimento: 'O que você quer que o órgão esclareça? (ex.: "item 9.3 não diz se aceita atestado de outra empresa do grupo")',
  impugnacao: 'O que está errado no edital e o que você quer que mude? (ex.: "exige atestado de 100% do objeto, item 9.3")',
  recurso: 'Seus argumentos (opcional): por que a decisão está errada?',
  contrarrazoes: 'Seus argumentos (opcional): por que o recurso não procede?',
};

const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const negocios = ref([]);
const negocioId = ref(route.query.negocio ? Number(route.query.negocio) : null);
const info = ref(null);
const gerando = ref('');
const form = ref({ tipo: 'impugnacao', fatos: '', decisao: '', item: '', representante: '', cidade: '' });
const dlg = ref(false);
const aberta = ref(null);
const texto = ref('');
const aba = ref('ver');
const salvando = ref(false);

const quando = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const prazoPassou = computed(() => info.value?.negocio.prazo_impugnacao && info.value.negocio.prazo_impugnacao < new Date().toISOString().slice(0, 10));

async function carregar() {
  info.value = null;
  if (!negocioId.value) return;
  router.replace({ query: { negocio: negocioId.value } });
  info.value = (await api.get('/juridico', { params: { negocio: negocioId.value } })).data;
}
async function analisar() {
  gerando.value = 'analise';
  try {
    info.value.pecas.unshift((await api.post('/juridico/analise', { negocio_id: negocioId.value }, { timeout: 600000 })).data);
  } finally {
    gerando.value = '';
  }
}
async function redigir() {
  gerando.value = 'peca';
  try {
    const corpo = Object.fromEntries(Object.entries(form.value).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]));
    const p = (await api.post('/juridico/pecas', { negocio_id: negocioId.value, ...corpo }, { timeout: 600000 })).data;
    info.value.pecas.unshift(p);
    abrir(p);
  } finally {
    gerando.value = '';
  }
}
function usarPonto(pt) {
  form.value.tipo = pt.sugestao;
  form.value.fatos = `${pt.titulo} (${pt.onde}): "${pt.trecho}". ${pt.problema} Fundamento: ${pt.fundamento}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  Notify.create({ type: 'info', message: 'Ponto copiado para "Nova peça". Revise e clique em Redigir.' });
}
function abrir(p) {
  aberta.value = p;
  texto.value = p.conteudo;
  aba.value = 'ver';
  dlg.value = true;
}
async function salvarTexto() {
  salvando.value = true;
  try {
    const p = (await api.patch(`/juridico/pecas/${aberta.value.id}`, { conteudo: texto.value })).data;
    const k = info.value.pecas.findIndex((x) => x.id === p.id);
    info.value.pecas[k] = p;
    aberta.value = p;
    Notify.create({ type: 'positive', message: 'Alterações salvas.' });
  } finally {
    salvando.value = false;
  }
}
async function copiar(p) {
  await copyToClipboard(p.conteudo.replace(/^#+\s*/gm, '').replace(/\*\*/g, ''));
  Notify.create({ type: 'positive', message: 'Texto copiado.' });
}
function apagar(p) {
  $q.dialog({ title: 'Apagar?', message: p.titulo, cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Apagar', color: 'negative', unelevated: true } })
    .onOk(async () => {
      await api.delete(`/juridico/pecas/${p.id}`);
      info.value.pecas = info.value.pecas.filter((x) => x.id !== p.id);
    });
}
onMounted(async () => {
  negocios.value = (await api.get('/negocios')).data;
  if (negocioId.value) carregar();
});
</script>

<style scoped>
.peca-previa { max-height: 180px; overflow: hidden; font-size: 13px; color: #374151; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
.peca-previa :deep(h2), .peca-previa :deep(h3) { font-size: 14px; margin: 6px 0; line-height: 1.3; }
.peca-doc { max-width: 820px; margin: 0 auto; font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.6; text-align: justify; }
.peca-doc :deep(h2), .peca-doc :deep(h3), .peca-doc :deep(h4) { font-size: 16px; font-weight: 700; text-transform: uppercase; margin: 18px 0 8px; line-height: 1.4; }
</style>

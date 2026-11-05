<template>
  <div class="row q-col-gutter-md">
    <div class="col-12 col-md-5">
      <q-card flat bordered class="lf-card">
        <q-card-section>
          <div class="text-subtitle1 text-weight-bold">Cole as mensagens do pregoeiro</div>
          <div class="text-body2 text-grey-7 q-mt-xs">
            No portal, abra o chat da sessão, clique nas mensagens, aperte <b>Ctrl+A</b> e <b>Ctrl+C</b>. Depois cole aqui (<b>Ctrl+V</b>).
            A IA mostra o que é com a sua empresa, os prazos e o que fazer.
          </div>
          <q-banner v-if="!temEmpresa" dense rounded class="bg-amber-1 text-amber-10 q-mt-sm">
            <template #avatar><q-icon name="business" /></template>
            Escolha a <b>empresa participante</b> no negócio para a IA reconhecer as mensagens dirigidas a você.
          </q-banner>
          <q-input v-model="texto" type="textarea" outlined autogrow :input-style="{ minHeight: '180px', maxHeight: '360px' }" class="q-mt-md"
            placeholder="05/11/2026 10:02:15 - Pregoeiro: Sr. Fornecedor..." counter :maxlength="60000" />
          <div class="row items-center q-mt-sm q-gutter-sm">
            <q-btn unelevated no-caps color="primary" icon="auto_awesome" label="Analisar com IA" :loading="analisando" :disable="!iaDisponivel || texto.trim().length < 20" @click="analisar" />
            <q-btn v-if="texto" flat no-caps label="Limpar" @click="texto = ''" />
          </div>
          <div v-if="!iaDisponivel" class="text-caption text-negative q-mt-xs">A IA não está ligada no servidor (falta a chave da IA).</div>
          <div class="text-caption text-grey-6 q-mt-sm">O sistema não acessa o portal: lê só o que você colar. Cada análise conta no limite diário de IA.</div>
        </q-card-section>
      </q-card>
    </div>

    <div class="col-12 col-md-7">
      <div v-if="analisando" class="row items-center q-gutter-sm text-grey-7 q-pa-md"><q-spinner-dots color="primary" size="28px" /><span>A IA está lendo o chat...</span></div>
      <div v-else-if="!analises.length" class="text-grey-7 q-pa-md">Nenhuma análise ainda. Cole o chat e clique em <b>Analisar com IA</b>.</div>

      <q-card v-for="(a, k) in analises" :key="a.id" flat bordered class="lf-card q-mb-md" :class="{ 'borda-alerta': k === 0 && a.analise.envolve_minha_empresa }">
        <q-card-section class="row items-start no-wrap q-pb-sm">
          <div class="col">
            <div class="row items-center q-gutter-sm">
              <q-badge v-if="a.analise.envolve_minha_empresa" color="negative" label="É com a sua empresa!" class="text-weight-bold q-pa-xs" />
              <q-badge v-else color="grey-6" label="Nada direto para você" />
              <span class="text-caption text-grey-7">{{ quando(a.criado_em) }}</span>
            </div>
            <div class="text-body1 q-mt-sm">{{ a.analise.resumo }}</div>
          </div>
          <q-btn flat round dense size="sm" icon="delete_outline" color="grey-6" @click="apagar(a)"><q-tooltip>Apagar análise</q-tooltip></q-btn>
        </q-card-section>

        <q-card-section v-if="a.analise.prazos.length" class="q-pt-none">
          <div class="rotulo">Prazos</div>
          <div v-for="(p, j) in a.analise.prazos" :key="j" class="prazo" :class="{ meu: p.me_envolve }">
            <q-icon name="alarm" :color="p.me_envolve ? 'negative' : 'grey-7'" class="q-mr-sm" />
            <div class="col">
              <div class="text-weight-medium">{{ p.descricao }}</div>
              <div class="text-caption">“{{ p.prazo_texto }}”<span v-if="p.limite"> · até <b>{{ dataHora(p.limite) }}</b> · lembrete na Agenda</span><span v-else> · confira o horário no portal</span></div>
            </div>
          </div>
        </q-card-section>

        <q-card-section v-if="a.analise.acoes.length" class="q-pt-none">
          <div class="rotulo">O que fazer agora</div>
          <ol class="q-my-none q-pl-md text-body2"><li v-for="(x, j) in a.analise.acoes" :key="j">{{ x }}</li></ol>
        </q-card-section>

        <q-card-section v-if="a.analise.alertas.length" class="q-pt-none">
          <div class="rotulo">Atenção</div>
          <div v-for="(x, j) in a.analise.alertas" :key="j" class="text-body2 text-orange-10"><q-icon name="warning" class="q-mr-xs" />{{ x }}</div>
        </q-card-section>

        <q-expansion-item v-if="a.analise.mensagens.length" dense dense-toggle :default-opened="k === 0" :label="`Mensagens importantes (${a.analise.mensagens.length})`" header-class="text-primary">
          <q-list dense separator class="q-px-md q-pb-sm">
            <q-item v-for="(m, j) in a.analise.mensagens" :key="j" :class="{ 'bg-red-1': m.me_envolve }">
              <q-item-section>
                <q-item-label caption>{{ m.data_hora || '' }}<span v-if="m.item"> · item {{ m.item }}</span> · {{ TIPOS[m.tipo] ?? m.tipo }}</q-item-label>
                <q-item-label class="text-italic">“{{ m.trecho }}”</q-item-label>
                <q-item-label caption class="text-grey-9">{{ m.explicacao }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
      </q-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useQuasar, Notify } from 'quasar';
import { api } from 'boot/axios';
import { dataHora } from 'src/format';

const props = defineProps({ negocioId: { type: Number, required: true }, temEmpresa: Boolean });
const TIPOS = {
  convocacao: 'Convocação', pedido_documento: 'Pedido de documento', diligencia: 'Diligência', aceite: 'Aceite', recusa: 'Recusa',
  habilitacao: 'Habilitação', inabilitacao: 'Inabilitação', adjudicacao: 'Adjudicação', intencao_recurso: 'Intenção de recurso',
  suspensao: 'Suspensão', reabertura: 'Reabertura', negociacao: 'Negociação', informativo: 'Informativo', outro: 'Outro',
};
const $q = useQuasar();
const texto = ref('');
const analises = ref([]);
const analisando = ref(false);
const iaDisponivel = ref(true);
const quando = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

async function carregar() {
  const r = (await api.get(`/disputa/negocio/${props.negocioId}/chat`)).data;
  analises.value = r.analises;
  iaDisponivel.value = r.iaDisponivel;
}
async function analisar() {
  analisando.value = true;
  try {
    const r = (await api.post(`/disputa/negocio/${props.negocioId}/chat`, { texto: texto.value }, { timeout: 180000 })).data;
    analises.value.unshift(r);
    texto.value = '';
    if (r.lembretes) Notify.create({ type: 'positive', message: `${r.lembretes} prazo(s) adicionado(s) à Agenda.` });
  } finally {
    analisando.value = false;
  }
}
function apagar(a) {
  $q.dialog({ title: 'Apagar esta análise?', cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Apagar', color: 'negative', unelevated: true } })
    .onOk(async () => {
      await api.delete(`/disputa/chat/${a.id}`);
      analises.value = analises.value.filter((x) => x.id !== a.id);
    });
}
onMounted(carregar);
</script>

<style scoped>
.rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin-bottom: 4px; }
.prazo { display: flex; align-items: flex-start; padding: 8px 10px; border-radius: 8px; background: #f6f8fa; margin-bottom: 6px; }
.prazo.meu { background: #fdecea; color: #7f1d1d; }
.borda-alerta { border-color: #e57373; }
</style>

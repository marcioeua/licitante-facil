<template>
  <q-dialog :model-value="modelValue" maximized @update:model-value="(v) => emit('update:modelValue', v)">
    <q-card class="column no-wrap">
      <q-toolbar class="bg-primary text-white">
        <q-icon name="request_quote" size="24px" class="q-mr-sm" />
        <q-toolbar-title class="text-subtitle1">Proposta de preços pronta</q-toolbar-title>
        <q-btn flat no-caps icon="download" label="Baixar Word" :disable="!podeGerar" @click="baixar" />
        <q-btn flat round icon="close" v-close-popup />
      </q-toolbar>
      <div class="col row">
        <div class="col-12 col-md-4 q-pa-md scroll" style="max-height: calc(100vh - 50px); border-right: 1px solid #e5e7eb">
          <q-banner v-if="!sala.negocio.empresa_id" dense rounded class="bg-orange-1 text-orange-10 q-mb-md">
            Escolha a <b>empresa participante</b> no negócio para a proposta sair com a razão social e o CNPJ.
          </q-banner>
          <q-btn-toggle v-model="tipo" spread no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9" class="q-mb-sm"
            :options="[{ label: 'Inicial (cadastro)', value: 'inicial' }, { label: 'Ajustada (após a disputa)', value: 'ajustada' }]" />
          <div class="text-caption text-grey-7 q-mb-md">
            {{ tipo === 'inicial' ? 'Usa o "lance inicial" de cada item (aba 1. Preparar preços).' : 'Usa o seu último lance de cada item (aba 2. Modo disputa).' }}
          </div>
          <q-banner v-if="semPreco.length" dense rounded class="bg-amber-1 text-amber-10 q-mb-md">
            {{ semPreco.length }} item(ns) sem preço: {{ semPreco.join(', ') }}. Preencha na Sala de disputa ou edite no Word.
          </q-banner>

          <div class="text-subtitle2 q-mb-xs">Dados da empresa</div>
          <div class="q-gutter-y-sm">
            <q-input v-model="emp.endereco" outlined dense label="Endereço completo" />
            <div class="row q-col-gutter-sm">
              <div class="col-6"><q-input v-model="emp.telefone" outlined dense label="Telefone" /></div>
              <div class="col-6"><q-input v-model="emp.email" outlined dense label="E-mail" /></div>
            </div>
            <q-input v-model="emp.banco" outlined dense label="Banco, agência e conta" />
            <q-input v-model="emp.representante" outlined dense label="Representante legal" />
            <div class="row q-col-gutter-sm">
              <div class="col-6"><q-input v-model="emp.representante_cargo" outlined dense label="Cargo" /></div>
              <div class="col-6"><q-input v-model="emp.representante_cpf" outlined dense label="CPF" /></div>
            </div>
            <div class="text-caption text-grey-6">Ficam salvos na empresa para as próximas propostas.</div>
          </div>

          <div class="text-subtitle2 q-mt-md q-mb-xs">Condições</div>
          <div class="q-gutter-y-sm">
            <q-input v-model.number="validade" type="number" outlined dense label="Validade da proposta (dias)" />
            <q-input v-model="prazoEntrega" outlined dense autogrow label="Prazo de entrega/execução" />
            <q-input v-model="pagamento" outlined dense autogrow label="Condições de pagamento" />
            <q-input v-model="cidade" outlined dense label="Cidade/UF (assinatura)" />
          </div>

          <div v-if="sala.edital?.requisitos_proposta?.length" class="q-mt-md">
            <div class="text-subtitle2">O edital pede na proposta</div>
            <ul class="q-my-xs q-pl-md text-body2"><li v-for="(r, k) in sala.edital.requisitos_proposta" :key="k">{{ r }}</li></ul>
          </div>
          <q-btn unelevated no-caps color="primary" icon="save" label="Salvar dados e atualizar" class="q-mt-md full-width" :loading="salvando" @click="salvarEmpresa" />
        </div>
        <div class="col-12 col-md q-pa-lg scroll" style="max-height: calc(100vh - 50px)">
          <div class="text-caption text-grey-7 q-mb-sm">Prévia. Confira tudo e ajuste no Word antes de anexar no portal. Campos entre [colchetes] faltam preencher.</div>
          <div class="proposta-doc" v-html="markdownParaHtml(prop.markdown)" />
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, reactive } from 'vue';
import { Notify } from 'quasar';
import { api } from 'boot/axios';
import { markdownParaHtml, baixarWord } from 'components/markdown.js';
import { montarProposta, precoDoItem } from 'components/proposta.js';

const props = defineProps({ modelValue: Boolean, sala: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue']);
const n = props.sala.negocio;
const tipo = ref(props.sala.itens.some((i) => i.meu_lance != null) ? 'ajustada' : 'inicial');
const emp = reactive({
  endereco: n.empresa_endereco ?? '', telefone: n.empresa_telefone ?? '', email: n.empresa_email ?? '', banco: n.empresa_banco ?? '',
  representante: n.empresa_representante ?? '', representante_cargo: n.empresa_representante_cargo ?? '', representante_cpf: n.empresa_representante_cpf ?? '',
});
const validade = ref(60);
const prazoEntrega = ref(props.sala.edital?.prazo_entrega ?? '');
const pagamento = ref(props.sala.edital?.pagamento ?? '');
const cidade = ref('');
const salvando = ref(false);

const semPreco = computed(() => props.sala.itens.filter((i) => precoDoItem(i, tipo.value) == null).map((i, k) => i.numero_item ?? k + 1));
const prop = computed(() => montarProposta({
  negocio: n, itens: props.sala.itens, tipo: tipo.value, validadeDias: validade.value || 60, prazoEntrega: prazoEntrega.value, pagamento: pagamento.value,
  cidade: cidade.value, empresa: { razao_social: n.empresa, cnpj: n.empresa_cnpj, ...emp },
}));
const podeGerar = computed(() => props.sala.itens.length > 0);

async function salvarEmpresa() {
  if (!n.empresa_id) return;
  salvando.value = true;
  try {
    await api.patch(`/empresas/${n.empresa_id}/dados`, { ...emp });
    Object.entries(emp).forEach(([k, v]) => { n[`empresa_${k}`] = v; });
    Notify.create({ type: 'positive', message: 'Dados da empresa salvos.' });
  } finally {
    salvando.value = false;
  }
}
async function baixar() {
  if (n.empresa_id) await salvarEmpresa().catch(() => {});
  baixarWord(`Proposta ${tipo.value === 'ajustada' ? 'ajustada ' : ''}- ${n.modalidade ?? ''} ${n.numero_compra ?? ''} ${n.orgao_nome ?? n.titulo}`, prop.value.markdown);
}
</script>

<style scoped>
.proposta-doc { max-width: 860px; margin: 0 auto; font-family: 'Times New Roman', serif; font-size: 15px; line-height: 1.5; }
.proposta-doc :deep(h3) { font-size: 17px; text-align: center; font-weight: 700; margin: 4px 0 14px; }
.proposta-doc :deep(h4) { font-size: 15px; font-weight: 700; margin: 16px 0 6px; }
.proposta-doc :deep(table) { border-collapse: collapse; width: 100%; font-size: 13px; }
.proposta-doc :deep(th), .proposta-doc :deep(td) { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
.proposta-doc :deep(th) { background: #f1f3f4; }
</style>

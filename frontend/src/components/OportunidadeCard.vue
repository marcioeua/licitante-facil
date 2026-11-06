<template>
  <q-card flat bordered class="lf-card">
    <q-card-section class="q-pb-sm">
      <div class="row items-center q-gutter-xs q-mb-xs">
        <q-badge color="blue-1" text-color="primary" :label="op.modalidade || 'Modalidade não informada'" />
        <q-badge v-if="op.uf" color="grey-3" text-color="grey-9" :label="op.uf" />
        <q-badge v-if="op.registro_preco" color="teal-1" text-color="teal-9" label="Registro de preço" />
        <q-badge v-if="prazo !== null && prazo <= 3 && prazo >= 0" color="orange-2" text-color="orange-10" :label="prazo === 0 ? 'Encerra hoje' : `Encerra em ${prazo} dia(s)`" />
        <q-badge v-if="pag" :color="pag.cor" text-color="white" :label="pag.rotulo"><q-tooltip>Pagômetro (CAPAG do Tesouro Nacional)</q-tooltip></q-badge>
        <q-badge v-if="op.alerta" color="amber-2" text-color="amber-10" :label="`Alerta: ${op.alerta}`" />
      </div>
      <router-link :to="{ name: 'oportunidade', params: { id: op.id } }" class="text-subtitle1 text-weight-medium text-dark text-objeto ellipsis-3" style="text-decoration: none">
        {{ op.objeto }}
      </router-link>
      <div class="text-grey-7 text-body2 q-mt-xs">
        <q-icon name="account_balance" size="16px" /> {{ op.orgao_nome }}<span v-if="op.municipio"> · {{ op.municipio }}</span>
      </div>
    </q-card-section>
    <q-card-section class="row items-center q-pt-none q-col-gutter-sm text-body2">
      <div class="col-12 col-sm"><span class="text-grey-7">Valor estimado</span><br /><b>{{ brl(op.valor_estimado) }}</b></div>
      <div class="col-12 col-sm"><span class="text-grey-7">Propostas até</span><br /><b>{{ dataHora(op.data_encerramento) }}</b></div>
      <div class="col-12 col-sm-auto">
        <q-btn v-if="op.negocio_id" flat no-caps color="positive" icon="check_circle" :label="etapa(op.negocio_etapa).nome"
          :to="{ name: 'negocio', params: { id: op.negocio_id } }" />
        <q-badge v-else-if="encerrada" color="grey-6" label="Propostas encerradas" class="q-pa-sm" />
        <q-btn v-else unelevated no-caps color="primary" icon="add" label="Adicionar ao funil" :loading="salvando" @click="adicionar" />
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Notify } from 'quasar';
import { api } from 'boot/axios';
import { brl, dataHora, diasAte, etapa } from 'src/format';

const props = defineProps({ op: { type: Object, required: true } });
const emit = defineEmits(['adicionado']);
const salvando = ref(false);
const prazo = computed(() => diasAte(props.op.data_encerramento));
const encerrada = computed(() => !!props.op.data_encerramento && new Date(props.op.data_encerramento) < new Date());
const pag = computed(() => ({
  baixo: { cor: 'positive', rotulo: 'Paga em dia' },
  medio: { cor: 'orange-8', rotulo: 'Pagamento: atenção' },
  alto: { cor: 'negative', rotulo: 'Risco de atraso' },
  federal: { cor: 'primary', rotulo: 'Federal' },
}[props.op.pagometro] ?? null));

async function adicionar() {
  salvando.value = true;
  try {
    const { data } = await api.post('/negocios', { oportunidade_id: props.op.id });
    Object.assign(props.op, { negocio_id: data.id, negocio_etapa: data.etapa });
    Notify.create({ type: 'positive', message: 'Adicionado ao seu funil.' });
    emit('adicionado', data);
  } finally {
    salvando.value = false;
  }
}
</script>

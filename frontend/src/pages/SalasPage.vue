<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="gavel" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold col">Sala de disputa</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Suas licitações em <b>Proposta</b> e <b>Disputa</b>, da sessão mais próxima para a mais distante. Clique para abrir a sala:
      preparar os preços, disputar com o painel, colar o chat do pregoeiro e cotar com fornecedores.
    </div>

    <q-btn-toggle v-model="filtro" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9" class="q-mb-md"
      :options="[{ label: 'Proposta e disputa', value: 'ativas' }, { label: 'Todas as etapas abertas', value: 'todas' }]" />

    <q-skeleton v-if="!negocios" height="200px" />
    <div v-else-if="!lista.length" class="text-center text-grey-7 q-pa-xl">
      <q-icon name="gavel" size="48px" class="q-mb-sm" />
      <div>Nenhuma licitação em Proposta ou Disputa.</div>
      <div class="text-body2 q-mt-xs">Em <b>Meus negócios</b>, arraste o cartão para a coluna <b>Proposta</b> ou <b>Disputa</b>, ou veja todas as etapas acima.</div>
      <q-btn flat no-caps color="primary" icon="view_kanban" label="Ir para Meus negócios" class="q-mt-sm" :to="{ name: 'negocios' }" />
    </div>
    <div v-else class="q-gutter-y-sm">
      <q-card v-for="n in lista" :key="n.id" flat bordered class="lf-card sala-item cursor-pointer" @click="$router.push({ name: 'disputa', params: { id: n.id } })">
        <q-card-section class="row items-center q-col-gutter-md">
          <div class="col-12 col-sm-auto">
            <div class="quando" :class="`q-${urgencia(n).cor}`">
              <div class="text-caption">{{ urgencia(n).rotulo }}</div>
              <div class="text-subtitle2 text-weight-bold">{{ n.data_disputa ? dataHora(n.data_disputa) : 'Sem data' }}</div>
            </div>
          </div>
          <div class="col">
            <div class="text-subtitle1 text-weight-medium ellipsis-2-lines">{{ n.titulo }}</div>
            <div class="text-caption text-grey-7">{{ n.orgao_nome || 'Negócio manual' }}{{ n.uf ? ` · ${n.uf}` : '' }}{{ n.modalidade ? ` · ${n.modalidade}` : '' }}</div>
            <div class="row q-gutter-xs q-mt-xs">
              <q-badge :color="etapa(n.etapa).cor" :label="etapa(n.etapa).nome" />
              <q-badge v-if="!n.itens_disputa" color="orange-2" text-color="orange-10" label="Sem itens na sala" />
              <q-badge v-else-if="n.itens_com_custo < n.itens_disputa" color="orange-2" text-color="orange-10" :label="`Preço mínimo em ${n.itens_com_custo} de ${n.itens_disputa} itens`" />
              <q-badge v-else color="green-1" text-color="green-9" :label="`${n.itens_disputa} item(ns) com preço mínimo`" />
            </div>
          </div>
          <div class="col-12 col-sm-auto">
            <q-btn unelevated no-caps color="primary" icon="gavel" label="Abrir sala" @click.stop="$router.push({ name: 'disputa', params: { id: n.id } })" />
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from 'boot/axios';
import { dataHora, etapa } from 'src/format';

const negocios = ref(null);
const filtro = ref('ativas');

const lista = computed(() => (negocios.value ?? [])
  .filter((n) => (filtro.value === 'ativas' ? ['proposta', 'disputa'].includes(n.etapa) : !['ganho', 'perdido'].includes(n.etapa)))
  .sort((a, b) => (a.data_disputa ?? '9999').localeCompare(b.data_disputa ?? '9999')));

function urgencia(n) {
  if (!n.data_disputa) return { rotulo: 'Sessão', cor: 'cinza' };
  const dias = Math.floor((new Date(n.data_disputa).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (dias < 0) return { rotulo: 'Já passou', cor: 'cinza' };
  if (dias === 0) return { rotulo: 'HOJE', cor: 'vermelho' };
  if (dias === 1) return { rotulo: 'Amanhã', cor: 'laranja' };
  return { rotulo: `Em ${dias} dias`, cor: dias <= 3 ? 'laranja' : 'azul' };
}

onMounted(async () => { negocios.value = (await api.get('/negocios')).data; });
</script>

<style scoped>
.sala-item:hover { box-shadow: 0 0 0 2px #1d4ed8; }
.quando { border-radius: 10px; padding: 8px 12px; min-width: 150px; text-align: center; }
.q-vermelho { background: #fdecea; color: #a61b1b; }
.q-laranja { background: #fff4e5; color: #8a4b00; }
.q-azul { background: #e8f0fe; color: #1a3d8f; }
.q-cinza { background: #f1f3f4; color: #5f6368; }
</style>

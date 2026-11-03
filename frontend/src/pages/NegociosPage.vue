<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <div class="text-h5 text-weight-bold col">Meus negócios</div>
      <q-toggle v-model="arquivados" label="Arquivados" />
      <q-btn unelevated no-caps color="primary" icon="add" label="Negócio manual" @click="novoManual" />
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">Arraste os cartões entre as colunas para mudar a etapa.</div>

    <div class="row no-wrap q-gutter-md scroll" style="overflow-x: auto; padding-bottom: 8px">
      <div v-for="e in ETAPAS" :key="e.valor" class="col-auto" style="width: 290px">
        <q-card flat bordered class="lf-card bg-grey-2 full-height">
          <q-card-section class="row items-center q-py-sm">
            <q-icon :name="e.icone" :color="e.cor" size="20px" class="q-mr-xs" />
            <div class="text-subtitle2 col">{{ e.nome }}</div>
            <q-badge :color="e.cor" :label="colunas[e.valor].length" />
          </q-card-section>
          <draggable v-model="colunas[e.valor]" item-key="id" group="negocios" class="q-px-sm q-pb-sm q-gutter-y-sm"
            style="min-height: 120px" :animation="150" @change="(ev) => mudou(e.valor, ev)">
            <template #item="{ element: n }">
              <q-card flat bordered class="lf-card cursor-pointer bg-white" @click="$router.push({ name: 'negocio', params: { id: n.id } })">
                <q-card-section class="q-pa-sm">
                  <div class="row no-wrap items-start">
                    <div class="text-body2 text-weight-medium col ellipsis-3">{{ n.titulo }}</div>
                    <q-icon v-if="n.favorito" name="star" color="amber" size="18px" />
                  </div>
                  <div class="text-caption text-grey-7 ellipsis">{{ n.orgao_nome || n.empresa_nome || 'Negócio manual' }}<span v-if="n.uf"> · {{ n.uf }}</span></div>
                  <div class="row items-center q-mt-xs text-caption q-gutter-x-sm">
                    <span v-if="n.data_disputa"><q-icon name="event" /> {{ dataHora(n.data_disputa) }}</span>
                    <span v-if="n.valor_estimado"><q-icon name="payments" /> {{ brl(n.valor_estimado) }}</span>
                  </div>
                  <q-linear-progress v-if="n.checklist_total" :value="n.checklist_feitos / n.checklist_total" color="positive" class="q-mt-xs" rounded />
                  <div v-if="n.responsavel" class="text-caption text-grey-8 q-mt-xs"><q-icon name="person" /> {{ n.responsavel }}</div>
                </q-card-section>
              </q-card>
            </template>
          </draggable>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import draggable from 'vuedraggable';
import { api } from 'boot/axios';
import { ETAPAS, brl, dataHora } from 'src/format';

const $q = useQuasar();
const router = useRouter();
const arquivados = ref(false);
const colunas = reactive(Object.fromEntries(ETAPAS.map((e) => [e.valor, []])));

async function carregar() {
  const lista = (await api.get('/negocios', { params: { arquivados: arquivados.value } })).data;
  for (const e of ETAPAS) colunas[e.valor] = lista.filter((n) => n.etapa === e.valor);
}

async function mudou(etapaValor, ev) {
  if (!ev.added && !ev.moved) return;
  const itens = colunas[etapaValor].map((n, posicao) => ({ id: n.id, etapa: etapaValor, posicao }));
  colunas[etapaValor].forEach((n) => (n.etapa = etapaValor));
  await api.post('/negocios/reordenar', itens);
}

function novoManual() {
  $q.dialog({ title: 'Novo negócio', message: 'Título (ex.: Pregão 12/2026 - Prefeitura de X)', prompt: { model: '', type: 'text' }, cancel: true })
    .onOk(async (titulo) => {
      if (!titulo?.trim()) return;
      const { data } = await api.post('/negocios', { titulo: titulo.trim() });
      router.push({ name: 'negocio', params: { id: data.id } });
    });
}

watch(arquivados, carregar);
onMounted(carregar);
</script>

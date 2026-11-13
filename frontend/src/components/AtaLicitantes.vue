<template>
  <div class="ata">
    <div class="row items-center q-gutter-sm">
      <q-icon name="groups" color="primary" size="20px" />
      <div class="text-subtitle2 text-weight-bold col">Todos os licitantes (ata da sessão)</div>
    </div>

    <div v-if="estado === 'inicio'" class="q-mt-xs">
      <q-btn dense outline no-caps size="sm" color="primary" icon="search" label="Procurar a ata no PNCP" :loading="carregando" @click="procurar" />
      <div class="text-caption text-grey-7 q-mt-xs">Mostra quem participou, com marca, modelo, valor e classificação, quando o órgão anexou a ata no PNCP.</div>
    </div>

    <div v-else-if="estado === 'sem_ata'" class="text-caption text-grey-7 q-mt-xs">
      {{ aviso || 'O órgão não anexou a ata da sessão no PNCP desta licitação. Muitos órgãos não publicam; nesses casos só temos o vencedor.' }}
    </div>

    <div v-else-if="estado === 'pode_ler'" class="q-mt-xs">
      <div class="text-caption text-grey-8">Encontramos no PNCP: <b>{{ candidatos[0].titulo }}</b><span v-if="candidatos.length > 1"> (+{{ candidatos.length - 1 }})</span>.</div>
      <q-btn dense unelevated no-caps size="sm" color="primary" icon="auto_awesome" label="Ler a ata com IA" class="q-mt-xs" :loading="carregando" @click="ler" />
      <div class="text-caption text-grey-6 q-mt-xs">Leva até 1 minuto. Custa alguns centavos (aparece em "Uso da IA") e fica guardado: da próxima vez abre na hora.</div>
    </div>

    <div v-else-if="estado === 'lida'" class="q-mt-xs">
      <div v-if="!ata.tem_propostas || !itensMostrados.length" class="text-caption text-grey-7">
        A ata não lista as propostas dos licitantes<span v-if="item"> deste item</span>.<span v-if="ata.observacao"> {{ ata.observacao }}</span>
      </div>
      <div v-for="it in itensMostrados" :key="it.numero" class="q-mt-sm">
        <div class="text-body2 text-weight-medium">Item {{ it.numero }} — {{ it.descricao }}</div>
        <div class="q-mt-xs">
          <div v-for="(pr, k) in ordenar(it.propostas)" :key="k" class="prop row items-center q-col-gutter-xs" :class="{ destaque: soNum(pr.cnpj) && soNum(pr.cnpj) === destacar }">
            <div class="col-auto"><q-badge :color="pr.classificacao === 1 ? 'positive' : 'grey-6'" rounded :label="pr.classificacao ? `${pr.classificacao}º` : '—'" /></div>
            <div class="col">
              <div class="text-body2 text-weight-medium">
                <router-link v-if="soNum(pr.cnpj).length === 14" :to="{ name: 'analise-empresas', params: { cnpj: soNum(pr.cnpj) } }" class="text-primary">{{ pr.fornecedor }}</router-link>
                <span v-else>{{ pr.fornecedor }}</span>
              </div>
              <div class="text-caption">
                <span class="text-deep-purple-8 text-weight-bold">Marca: {{ pr.marca || '—' }}</span>
                <span v-if="pr.modelo && pr.modelo !== 'N/A'"> · Modelo: {{ pr.modelo }}</span>
                <span v-if="pr.situacao"> · <span :class="corSituacao(pr.situacao)">{{ pr.situacao }}</span></span>
              </div>
              <div v-if="pr.motivo" class="text-caption text-grey-7">{{ pr.motivo }}</div>
            </div>
            <div class="col-auto text-right"><div class="text-weight-bold">{{ brl2(pr.valor_unitario) }}</div><div v-if="pr.valor_total" class="text-caption text-grey-7">total {{ brl2(pr.valor_total) }}</div></div>
          </div>
        </div>
      </div>
      <div v-if="item && outrosItens" class="q-mt-xs">
        <q-btn flat dense no-caps size="sm" color="primary" :label="todos ? 'Mostrar só este item' : `Ver todos os itens da ata (${ata.itens.length})`" @click="todos = !todos" />
      </div>
      <div class="text-caption text-grey-6 q-mt-xs">Fonte: {{ arquivo }} (anexado pelo órgão no PNCP), lido pela IA. Confira no documento original em caso de dúvida.</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from 'boot/axios';

const props = defineProps({
  compra: { type: String, required: true },
  item: { type: [Number, String], default: null },
  destacarCnpj: { type: String, default: null },
});
const estado = ref('inicio');
const carregando = ref(false);
const candidatos = ref([]);
const ata = ref(null);
const arquivo = ref('');
const aviso = ref('');
const todos = ref(false);
const soNum = (v) => String(v ?? '').replace(/\D/g, '');
const destacar = computed(() => soNum(props.destacarCnpj));
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const mesmoItem = (n) => Number(soNum(n)) === Number(props.item);
const outrosItens = computed(() => (ata.value?.itens ?? []).some((i) => !mesmoItem(i.numero)));
const itensMostrados = computed(() => {
  const lista = ata.value?.itens ?? [];
  if (!props.item || todos.value) return lista;
  const so = lista.filter((i) => mesmoItem(i.numero));
  return so.length ? so : lista;
});
const ordenar = (ps) => [...ps].sort((a, b) => (a.classificacao ?? 999) - (b.classificacao ?? 999) || (a.valor_unitario ?? 1e15) - (b.valor_unitario ?? 1e15));
function corSituacao(s) {
  if (/vencedor|arrematante|aceit|habilitad|adjudic|homolog/i.test(s) && !/inabilit|desclass/i.test(s)) return 'text-positive';
  if (/inabilit|desclass|recus|rejeit/i.test(s)) return 'text-negative';
  return 'text-grey-8';
}
function aplicar(d) {
  if (d.ata) { ata.value = d.ata; arquivo.value = d.arquivo; estado.value = 'lida'; return; }
  candidatos.value = d.candidatos ?? [];
  aviso.value = d.aviso ?? '';
  estado.value = d.semAta || !candidatos.value.length ? 'sem_ata' : 'pode_ler';
}
async function procurar() {
  carregando.value = true;
  try { aplicar((await api.get('/compras/ata', { params: { controle: props.compra }, timeout: 30000 })).data); } finally { carregando.value = false; }
}
async function ler() {
  carregando.value = true;
  try { aplicar((await api.post('/compras/ata', { controle: props.compra }, { timeout: 180000 })).data); } finally { carregando.value = false; }
}
</script>

<style scoped>
.ata { border-top: 1px dashed rgba(100, 116, 139, 0.4); padding-top: 8px; margin-top: 10px; }
.prop { border-radius: 6px; padding: 4px 6px; }
.prop + .prop { border-top: 1px solid rgba(100, 116, 139, 0.15); }
.destaque { background: rgba(29, 78, 216, 0.08); }
</style>

<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="do_not_disturb_on" color="deep-orange-7" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Licitações desertas</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Itens em que <b>ninguém participou</b> (deserto) ou <b>ninguém foi aprovado</b> (fracassado). O órgão ainda precisa comprar:
      costuma <b>repetir a licitação</b> ou <b>comprar direto por dispensa</b> (art. 75, III, da Lei 14.133). Se você vende o item, é uma boa hora para procurar o órgão e ficar de olho.
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-3">
          <q-input v-model="q" outlined dense clearable placeholder="Produto (opcional). Ex.: ventilador, limpeza" @keyup.enter="buscar(1)" @clear="buscar(1)">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>
        <div class="col-6 col-md-2"><q-select :model-value="uf" :options="UFS" outlined dense clearable label="Estado" @update:model-value="(v) => { uf = v; buscar(1); }" /></div>
        <div class="col-6 col-md-3">
          <q-btn-toggle :model-value="tipo" spread no-caps unelevated dense toggle-color="deep-orange-7" color="grey-2" text-color="grey-9" @update:model-value="(v) => { tipo = v; buscar(1); }"
            :options="[{ label: 'Todos', value: 'ambos' }, { label: 'Desertos', value: 'deserto' }, { label: 'Fracassados', value: 'fracassado' }]" />
        </div>
        <div class="col-6 col-md-2"><q-select :model-value="tipoObjeto" :options="TIPOS" emit-value map-options outlined dense label="Produtos ou serviços" @update:model-value="(v) => { tipoObjeto = v; buscar(1); }" /></div>
        <div class="col-6 col-md-2"><q-btn unelevated no-caps color="primary" icon="search" label="Buscar" class="full-width" :loading="carregando" @click="buscar(1)" /></div>
      </q-card-section>
    </q-card>

    <div v-if="dados" class="text-body2 text-grey-7 q-mb-sm">{{ dados.total.toLocaleString('pt-BR') }} licitação(ões) com itens {{ tipo === 'deserto' ? 'desertos' : tipo === 'fracassado' ? 'fracassados' : 'desertos ou fracassados' }}</div>
    <div v-if="dados && !dados.compras.length && !carregando" class="text-grey-7 q-pa-lg text-center">Nenhuma encontrada com esses filtros.</div>

    <q-card v-for="c in dados?.compras ?? []" :key="c.controle" flat bordered class="lf-card q-mb-md">
      <q-card-section class="q-pb-sm">
        <div class="row items-start no-wrap q-gutter-x-sm">
          <div class="col text-caption text-grey-7 text-uppercase">
            <span v-if="c.orgao" class="text-weight-bold text-grey-9">{{ c.orgao }}</span>
            <span v-if="c.modalidade"> · {{ c.modalidade }}<span v-if="c.numero"> Nº {{ c.numero }}/{{ c.ano }}</span></span>
            <span v-if="c.municipio || c.uf"> · {{ c.municipio ? `${c.municipio}/` : '' }}{{ c.uf }}</span>
          </div>
          <div class="text-right">
            <q-badge v-if="c.desertos" color="deep-orange-1" text-color="deep-orange-9" class="q-mr-xs" :label="`${c.desertos} deserto(s)`" />
            <q-badge v-if="c.fracassados" color="red-1" text-color="red-9" :label="`${c.fracassados} fracassado(s)`" />
          </div>
        </div>
        <div v-if="c.objeto" class="text-body2 q-mt-xs">{{ c.objeto }}</div>
        <div class="text-caption text-grey-6">Resultado em {{ data(c.quando) }} · {{ c.desertos + c.fracassados }} de {{ c.totalItensCompra }} item(ns) sem vencedor<span v-if="c.valorTotal"> · o órgão estimava pagar {{ brl2(c.valorTotal) }} por eles</span></div>
      </q-card-section>
      <q-markup-table flat dense class="q-mx-md tabela">
        <thead><tr><th class="text-left">Item</th><th class="text-left">Descrição</th><th class="text-right">Qtd.</th><th class="text-right">Valor unit. estimado</th><th class="text-left">Situação</th></tr></thead>
        <tbody>
          <tr v-for="i in c.itens" :key="i.numero">
            <td>{{ i.numero }}</td><td class="desc">{{ i.descricao }}</td>
            <td class="text-right">{{ num(i.quantidade) }} <span class="text-caption text-grey-7">{{ i.unidade }}</span></td>
            <td class="text-right text-weight-bold">{{ i.valorUnitario != null ? brl2(i.valorUnitario) : 'sigiloso' }}</td>
            <td><q-badge :color="i.situacao === 'Deserto' ? 'deep-orange-1' : 'red-1'" :text-color="i.situacao === 'Deserto' ? 'deep-orange-9' : 'red-9'" :label="i.situacao" /></td>
          </tr>
        </tbody>
      </q-markup-table>
      <div v-if="c.maisItens" class="q-px-md text-caption text-grey-7">… e mais {{ c.maisItens }} item(ns) — veja todos no PNCP.</div>
      <q-card-actions class="q-px-md">
        <q-btn v-if="c.orgaoCnpj" flat dense no-caps color="primary" icon="account_balance" label="Ver o órgão (licitações abertas)" :to="{ name: 'orgao', params: { cnpj: c.orgaoCnpj } }" />
        <q-btn v-if="c.itens[0]" flat dense no-caps color="primary" icon="local_shipping" label="Quem vende isso" :to="{ name: 'fornecedores', query: { q: termo(c.itens[0].descricao) } }" />
        <q-space />
        <q-btn v-if="c.linkPncp" flat dense no-caps color="primary" icon="open_in_new" label="Ver no PNCP" :href="c.linkPncp" target="_blank" rel="noopener" />
      </q-card-actions>
    </q-card>

    <div v-if="dados && dados.total > dados.tamanho" class="row justify-center q-mt-md">
      <q-pagination v-model="pagina" :max="Math.ceil(dados.total / dados.tamanho)" :max-pages="7" direction-links boundary-numbers @update:model-value="buscar" />
    </div>
    <div class="text-caption text-grey-6 q-mt-md">Fonte: situação oficial de cada item nos Dados Abertos do Compras.gov.br (compras feitas por esse portal), guardada pelo sistema todo dia. Outros portais não publicam a situação do item.</div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { data } from 'src/format';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const route = useRoute();
const router = useRouter();
const q = ref(String(route.query.q ?? ''));
const uf = ref(route.query.uf ?? null);
const tipo = ref(route.query.tipo ?? 'ambos');
const tipoObjeto = ref(route.query.tipoObjeto ?? null);
const TIPOS = [{ label: 'Todos', value: null }, { label: 'Só produtos', value: 'produto' }, { label: 'Só serviços', value: 'servico' }];
const pagina = ref(1);
const dados = ref(null);
const carregando = ref(false);
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const termo = (d) => String(d ?? '').split(/[,;:(]/)[0].trim().split(/\s+/).slice(0, 3).join(' ');

async function buscar(p = pagina.value) {
  pagina.value = p;
  carregando.value = true;
  router.replace({ query: { q: q.value || undefined, uf: uf.value || undefined, tipo: tipo.value !== 'ambos' ? tipo.value : undefined, tipoObjeto: tipoObjeto.value || undefined } });
  try {
    dados.value = (await api.get('/desertas', { params: { q: q.value || undefined, uf: uf.value || undefined, tipo: tipo.value, tipoObjeto: tipoObjeto.value || undefined, pagina: p }, timeout: 60000 })).data;
    if (p > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    carregando.value = false;
  }
}
onMounted(() => buscar(1));
</script>

<style scoped>
.tabela { background: transparent; }
.tabela .desc { white-space: normal; min-width: 200px; }
</style>

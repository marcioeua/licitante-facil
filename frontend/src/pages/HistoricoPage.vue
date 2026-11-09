<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-xs">Histórico de compras</div>
    <div class="text-body2 text-grey-7 q-mb-md">Quem comprou, quem venceu e por quanto, com dados oficiais do PNCP.</div>

    <q-tabs v-model="aba" align="left" no-caps active-color="primary" indicator-color="primary" class="q-mb-md">
      <q-tab name="precos" icon="price_check" label="Pesquisa de preços" />
      <q-tab name="contratos" icon="handshake" label="Contratos" />
    </q-tabs>

    <!-- PESQUISA DE PREÇOS -->
    <template v-if="aba === 'precos'">
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row q-col-gutter-sm items-start">
          <div class="col-12 col-md-5">
            <q-input v-model="fp.q" outlined dense label="Item" placeholder="Ex.: dipirona 500mg, cadeira escolar, papel A4" @keyup.enter="pesquisar" />
          </div>
          <div class="col-12 col-md-4">
            <q-input v-model="fp.assunto" outlined dense label="Assunto da compra (opcional)" placeholder="Ex.: medicamentos, mobiliário, expediente"
              hint="Ajuda a achar compras quando o contrato descreve o objeto de forma geral" @keyup.enter="pesquisar" />
          </div>
          <div class="col-6 col-md-1"><q-select v-model="fp.uf" :options="filtros.ufs" outlined dense clearable label="UF" /></div>
          <div class="col-6 col-md-2"><q-btn unelevated no-caps color="primary" icon="search" label="Pesquisar" class="full-width" :loading="pesquisando" @click="pesquisar" /></div>
        </q-card-section>
      </q-card>

      <div v-if="pesquisando" class="row items-center q-gutter-sm text-grey-7 q-mb-md">
        <q-spinner-dots color="primary" size="30px" /><span>Consultando os resultados das compras no PNCP... pode levar até 1 minuto.</span>
      </div>

      <template v-if="precos && !pesquisando">
        <q-banner v-if="precos.incompleto || precos.falhas" rounded class="bg-amber-1 text-amber-10 q-mb-md">
          <template #avatar><q-icon name="schedule" color="amber-9" /></template>
          O site do governo (PNCP) está lento ou fora do ar agora, então mostramos só o que deu para consultar.
          A consulta continua em segundo plano: pesquise de novo em alguns minutos para ver mais preços.
        </q-banner>
        <div v-if="!precos.grupos.length" class="text-grey-7 q-pa-md">
          Nenhum preço homologado encontrado para "{{ ultimaBusca }}".
          Tente outro termo, preencha o assunto (ex.: "medicamentos") ou pesquise de novo para consultar mais compras.
        </div>
        <div class="row q-col-gutter-md q-mb-md">
          <div v-for="g in precos.grupos.slice(0, 3)" :key="g.unidade" class="col-12 col-md-4">
            <q-card flat bordered class="lf-card">
              <q-card-section>
                <div class="text-caption text-grey-7">Por {{ g.unidade }} · {{ g.quantidade }} resultado(s)</div>
                <div class="row q-mt-sm text-center">
                  <div class="col"><div class="text-caption text-grey-7">Menor</div><div class="text-subtitle1 text-positive text-weight-bold">{{ brl2(g.minimo) }}</div></div>
                  <div class="col"><div class="text-caption text-grey-7">Mediana</div><div class="text-subtitle1 text-weight-bold">{{ brl2(g.mediana) }}</div></div>
                  <div class="col"><div class="text-caption text-grey-7">Maior</div><div class="text-subtitle1 text-negative text-weight-bold">{{ brl2(g.maximo) }}</div></div>
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
        <q-table v-if="precos.itens.length" flat bordered class="lf-card" :rows="precos.itens" :columns="colPrecos" row-key="link" :pagination="{ rowsPerPage: 20 }">
          <template #body-cell-descricao="p"><q-td :props="p" style="white-space: normal; min-width: 220px">{{ p.value }}</q-td></template>
          <template #body-cell-fornecedor="p">
            <q-td :props="p" style="white-space: normal">
              <a href="#" class="text-primary" @click.prevent="verFornecedor(p.row.fornecedorNi, p.row.fornecedor)">{{ p.value }}</a>
              <q-badge v-if="p.row.porte" color="grey-3" text-color="grey-8" class="q-ml-xs">{{ p.row.porte }}</q-badge>
            </q-td>
          </template>
          <template #body-cell-link="p"><q-td :props="p"><q-btn v-if="p.value" flat round dense size="sm" icon="open_in_new" :href="p.value" target="_blank" rel="noopener" /></q-td></template>
        </q-table>
        <div class="text-caption text-grey-6 q-mt-sm">
          Preços unitários homologados (valor final do vencedor) publicados no PNCP. Compras consultadas agora: {{ precos.consultadas }}.
          Pesquise de novo para incluir mais compras.
        </div>
      </template>
    </template>

    <!-- CONTRATOS -->
    <template v-else>
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row q-col-gutter-sm items-center">
          <div class="col-12 col-md-6">
            <q-input v-model="fc.q" outlined dense clearable debounce="400" placeholder="O que foi comprado? Ex.: material de limpeza, merenda, notebook">
              <template #prepend><q-icon name="search" /></template>
            </q-input>
          </div>
          <div class="col-6 col-md-2"><q-select v-model="fc.uf" :options="filtros.ufs" outlined dense clearable label="UF" /></div>
          <div v-if="fc.fornecedor || fc.orgao" class="col-12 col-md-4">
            <q-chip removable color="blue-1" text-color="primary" @remove="fc.fornecedor = null; fc.orgao = null; filtroNome = ''">
              {{ fc.fornecedor ? 'Fornecedor' : 'Órgão' }}: {{ filtroNome }}
            </q-chip>
          </div>
        </q-card-section>
      </q-card>

      <div v-if="contratos" class="row q-col-gutter-md">
        <div class="col-12 col-md-8">
          <div class="text-body2 text-grey-8 q-mb-sm">
            <q-spinner v-if="carregandoContratos" size="16px" class="q-mr-xs" />
            {{ contratos.total.toLocaleString('pt-BR') }} contrato(s) · total {{ brl(contratos.valorTotal) }}
            <span v-if="contratos.periodo?.de" class="text-grey-6">· publicados de {{ data(contratos.periodo.de) }} a {{ data(contratos.periodo.ate) }}</span>
          </div>
          <div v-if="!contratos.periodo?.dias" class="text-grey-7 q-pa-md">O histórico de contratos ainda está sendo carregado do PNCP. Volte em algumas horas.</div>
          <q-list bordered separator class="lf-card bg-white">
            <q-item v-for="c in contratos.itens" :key="c.id">
              <q-item-section>
                <q-item-label class="ellipsis-3">{{ c.objeto }}</q-item-label>
                <q-item-label caption>
                  <q-icon name="account_balance" /> <a href="#" class="text-grey-8" @click.prevent="verOrgao(c.orgao_cnpj, c.orgao_nome)">{{ c.orgao_nome }}</a>
                  <span v-if="c.municipio"> · {{ c.municipio }}/{{ c.uf }}</span>
                </q-item-label>
                <q-item-label caption>
                  <q-icon name="emoji_events" color="amber-8" /> <a href="#" class="text-primary" @click.prevent="verFornecedor(c.fornecedor_ni, c.fornecedor_nome)">{{ c.fornecedor_nome || 'Fornecedor não informado' }}</a>
                </q-item-label>
              </q-item-section>
              <q-item-section side top class="text-right">
                <div class="text-weight-bold text-dark">{{ brl(c.valor_global) }}</div>
                <div class="text-caption">{{ data(c.data_assinatura) }}</div>
              </q-item-section>
            </q-item>
          </q-list>
          <div class="flex flex-center q-mt-md" v-if="paginasContratos > 1">
            <q-pagination v-model="fc.pagina" :max="paginasContratos" :max-pages="7" direction-links />
          </div>
        </div>
        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none"><q-icon name="emoji_events" color="amber-8" /> Quem mais vence</q-card-section>
            <q-list dense>
              <q-item v-for="f in contratos.fornecedores" :key="f.ni" clickable @click="verFornecedor(f.ni, f.nome)">
                <q-item-section><q-item-label lines="1">{{ f.nome }}</q-item-label><q-item-label caption>{{ f.contratos }} contrato(s)</q-item-label></q-item-section>
                <q-item-section side class="text-caption">{{ brl(f.valor) }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none"><q-icon name="account_balance" color="primary" /> Quem mais compra</q-card-section>
            <q-list dense>
              <q-item v-for="o in contratos.compradores" :key="o.cnpj" clickable @click="verOrgao(o.cnpj, o.nome)">
                <q-item-section><q-item-label lines="1">{{ o.nome }}</q-item-label><q-item-label caption>{{ o.uf }} · {{ o.contratos }} contrato(s)</q-item-label></q-item-section>
                <q-item-section side class="text-caption">{{ brl(o.valor) }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { brl, data } from 'src/format';

const route = useRoute();
const filtros = useFiltros();
const aba = ref(route.query.aba === 'contratos' ? 'contratos' : 'precos');
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));

// Pesquisa de preços
const fp = reactive({ q: route.query.q ?? '', assunto: route.query.assunto ?? '', uf: null });
const precos = ref(null);
const pesquisando = ref(false);
const ultimaBusca = ref('');
const colPrecos = [
  { name: 'descricao', label: 'Item', field: 'descricao', align: 'left' },
  { name: 'valorUnitario', label: 'Preço unit.', field: 'valorUnitario', format: (v) => brl2(v), sortable: true },
  { name: 'unidade', label: 'Unidade', field: 'unidade', align: 'left' },
  { name: 'quantidade', label: 'Qtd.', field: 'quantidade', format: (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR')) },
  { name: 'fornecedor', label: 'Vencedor', field: 'fornecedor', align: 'left' },
  { name: 'orgao', label: 'Comprador', field: (r) => `${r.orgao ?? '—'}${r.uf ? ' · ' + r.uf : ''}`, align: 'left' },
  { name: 'data', label: 'Data', field: 'data', format: data, sortable: true },
  { name: 'link', label: '', field: 'link' },
];

async function pesquisar() {
  if (fp.q.trim().length < 3) return;
  pesquisando.value = true;
  ultimaBusca.value = fp.q.trim();
  try {
    precos.value = (await api.get('/historico/precos', { params: { q: fp.q, assunto: fp.assunto || undefined, uf: fp.uf || undefined }, timeout: 180000 })).data;
  } finally {
    pesquisando.value = false;
  }
}

// Contratos
const fc = reactive({ q: aba.value === 'contratos' ? route.query.q ?? '' : '', uf: null, fornecedor: route.query.fornecedor ?? null, orgao: route.query.orgao ?? null, pagina: 1 });
const filtroNome = ref(String(route.query.nome ?? ''));
const contratos = ref(null);
const carregandoContratos = ref(false);
const paginasContratos = computed(() => (contratos.value ? Math.ceil(contratos.value.total / contratos.value.tamanho) : 0));

async function carregarContratos() {
  carregandoContratos.value = true;
  try {
    const params = Object.fromEntries(Object.entries(fc).filter(([, v]) => v));
    contratos.value = (await api.get('/historico/contratos', { params })).data;
  } finally {
    carregandoContratos.value = false;
  }
}
function verFornecedor(ni, nome) {
  if (!ni) return;
  Object.assign(fc, { fornecedor: ni, orgao: null, q: '', pagina: 1 });
  filtroNome.value = nome;
  aba.value = 'contratos';
}
function verOrgao(cnpj, nome) {
  if (!cnpj) return;
  Object.assign(fc, { orgao: cnpj, fornecedor: null, q: '', pagina: 1 });
  filtroNome.value = nome;
  aba.value = 'contratos';
}

watch(() => [fc.q, fc.uf, fc.fornecedor, fc.orgao], () => {
  if (fc.pagina !== 1) fc.pagina = 1;
  else carregarContratos();
});
watch(() => fc.pagina, carregarContratos);
watch(aba, (a) => { if (a === 'contratos' && !contratos.value) carregarContratos(); });

onMounted(async () => {
  await filtros.carregar();
  if (aba.value === 'contratos') carregarContratos();
  else if (fp.q) pesquisar();
});
</script>

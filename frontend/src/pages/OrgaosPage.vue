<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="account_balance" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Órgãos</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Órgãos públicos que compraram nos últimos 12 meses: a que ente pertencem, quanto compram, se têm licitação aberta e se o ente costuma pagar em dia (Pagômetro).
    </div>

    <div v-if="dados?.meus?.length" class="q-mb-md">
      <div class="text-subtitle2 text-weight-bold q-mb-xs">Órgãos dos seus negócios</div>
      <div class="row q-gutter-sm">
        <q-chip v-for="m in dados.meus" :key="m.cnpj" clickable outline color="primary" icon="account_balance" @click="$router.push({ name: 'orgao', params: { cnpj: m.cnpj } })">
          {{ curto(m.nome, 50) }}<q-badge v-if="m.negocios > 1" color="primary" class="q-ml-xs">{{ m.negocios }}</q-badge>
        </q-chip>
      </div>
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm">
        <div class="col-12 col-md-6">
          <q-input v-model="q" outlined dense clearable debounce="400" placeholder="Nome do órgão ou CNPJ" @update:model-value="buscar(1)">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>
        <div class="col-6 col-md-3"><q-select v-model="uf" :options="UFS" outlined dense clearable label="Estado" @update:model-value="buscar(1)" /></div>
        <div class="col-6 col-md-3">
          <q-select v-model="esfera" :options="ESFERAS" emit-value map-options outlined dense clearable label="Esfera" @update:model-value="buscar(1)" />
        </div>
      </q-card-section>
    </q-card>

    <div class="text-body2 text-grey-7 q-mb-sm">
      <span v-if="dados">{{ num(dados.total) }} órgão(s)</span>
      <q-spinner-dots v-if="carregando" color="primary" size="20px" class="q-ml-sm" />
    </div>

    <div class="q-gutter-y-sm">
      <q-card v-for="o in dados?.itens ?? []" :key="o.cnpj" flat bordered class="lf-card orgao-item cursor-pointer" @click="$router.push({ name: 'orgao', params: { cnpj: o.cnpj } })">
        <q-card-section class="q-pb-sm">
          <div class="text-subtitle1 text-weight-bold">{{ o.nome }}</div>
          <div class="row items-center q-gutter-x-sm text-caption text-grey-7">
            <q-badge v-if="o.esferaNome" outline color="grey-7" :label="o.esferaNome" />
            <span>{{ cnpj(o.cnpj) }}</span>
            <span v-if="o.municipio || o.uf">· {{ o.municipio ? `${o.municipio}/` : '' }}{{ o.uf }}</span>
          </div>
          <div v-if="o.ente" class="text-caption text-grey-7 q-mt-xs">
            <q-icon name="account_balance" size="14px" /> {{ o.proprioEnte ? 'É o próprio ente' : `Pertence a: ${o.ente}` }}
          </div>
        </q-card-section>
        <q-card-section class="row q-col-gutter-sm q-pt-none">
          <div class="col-6 col-sm-3"><div class="caixa" :class="`pag-${o.pagometro.nivel}`">
            <div class="rot">Pagômetro</div><div class="val">{{ PAG[o.pagometro.nivel]?.nome ?? 'Sem nota' }}<span v-if="o.pagometro.nota"> · {{ o.pagometro.nota }}</span></div>
          </div></div>
          <div class="col-6 col-sm-3"><div class="caixa"><div class="rot">Abertas agora</div><div class="val" :class="o.abertas ? 'text-positive' : ''">{{ num(o.abertas) }}</div></div></div>
          <div class="col-6 col-sm-3"><div class="caixa"><div class="rot">Licitações · 12 meses</div><div class="val">{{ num(o.licitacoes12m) }}</div></div></div>
          <div class="col-6 col-sm-3"><div class="caixa"><div class="rot">Contratado · 12 meses</div><div class="val">{{ brlCurto(o.valor12m) }}</div><div class="text-caption text-grey-6">{{ num(o.contratos12m) }} contrato(s)</div></div></div>
        </q-card-section>
      </q-card>
    </div>
    <div v-if="dados && !dados.itens.length && !carregando" class="text-grey-7 q-pa-lg text-center">Nenhum órgão encontrado com esses filtros.</div>
    <div v-if="dados && dados.total > dados.tamanho" class="row justify-center q-mt-md">
      <q-pagination v-model="pagina" :max="Math.ceil(dados.total / dados.tamanho)" :max-pages="7" direction-links boundary-numbers @update:model-value="buscar" />
    </div>
    <div class="text-caption text-grey-6 q-mt-md">Fontes: contratos e licitações do PNCP guardados no sistema (últimos 12 meses) e nota CAPAG do Tesouro Nacional. Atualizado todo dia.</div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from 'boot/axios';
import { cnpj, brl } from 'src/format';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ESFERAS = [{ label: 'Municipal', value: 'M' }, { label: 'Estadual', value: 'E' }, { label: 'Distrital', value: 'D' }, { label: 'Federal', value: 'F' }];
const PAG = { baixo: { nome: 'Paga em dia' }, medio: { nome: 'Atenção' }, alto: { nome: 'Risco de atraso' }, federal: { nome: 'Federal' }, indisponivel: { nome: 'Sem nota' } };

const dados = ref(null);
const carregando = ref(false);
const q = ref('');
const uf = ref(null);
const esfera = ref(null);
const pagina = ref(1);
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const curto = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t);
const brlCurto = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : brl(v));

async function buscar(p = pagina.value) {
  pagina.value = p;
  carregando.value = true;
  try {
    dados.value = (await api.get('/orgaos', { params: { q: q.value || undefined, uf: uf.value || undefined, esfera: esfera.value || undefined, pagina: p } })).data;
  } finally {
    carregando.value = false;
  }
}
onMounted(() => buscar(1));
</script>

<style scoped>
.orgao-item:hover { box-shadow: 0 0 0 2px #1d4ed8; }
.caixa { border-radius: 8px; padding: 6px 10px; background: rgba(100, 116, 139, 0.08); height: 100%; }
.rot { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
.val { font-weight: 700; font-size: 15px; }
.pag-baixo { background: rgba(34, 197, 94, 0.14); }
.pag-medio { background: rgba(245, 158, 11, 0.16); }
.pag-alto { background: rgba(239, 68, 68, 0.14); }
.pag-federal { background: rgba(59, 130, 246, 0.14); }
</style>

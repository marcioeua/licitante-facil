<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Órgãos" class="q-mb-sm" :to="{ name: 'orgaos' }" />
    <q-skeleton v-if="!o && !erro" height="300px" />
    <div v-else-if="erro" class="text-grey-7 q-pa-lg">{{ erro }}</div>
    <template v-else>
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section>
          <div class="text-h6 text-weight-bold">{{ o.nome }}</div>
          <div class="row items-center q-gutter-x-sm text-body2 text-grey-7">
            <q-badge v-if="o.esferaNome" outline color="grey-7" :label="o.esferaNome" />
            <span>CNPJ {{ cnpj(o.cnpj) }}</span>
            <span v-if="o.municipio || o.uf">· {{ o.municipio ? `${o.municipio}/` : '' }}{{ o.uf }}</span>
          </div>
          <div v-if="o.ente" class="text-body2 text-grey-7 q-mt-xs"><q-icon name="account_balance" size="16px" /> {{ o.proprioEnte ? 'É o próprio ente' : `Pertence a: ${o.ente}` }}</div>
        </q-card-section>
        <q-card-section class="row q-col-gutter-md q-pt-none">
          <div v-for="k in kpis" :key="k.nome" class="col-6 col-md">
            <div class="text-caption text-grey-7">{{ k.nome }}</div>
            <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
          </div>
        </q-card-section>
      </q-card>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Licitações abertas agora ({{ o.abertas.length }})</q-card-section>
            <q-card-section v-if="!o.abertas.length" class="text-grey-7">Nenhuma licitação com propostas abertas neste momento.</q-card-section>
            <q-list v-else separator>
              <q-item v-for="a in o.abertas" :key="a.id" clickable :to="{ name: 'oportunidade', params: { id: a.id } }">
                <q-item-section>
                  <q-item-label lines="2">{{ a.objeto }}</q-item-label>
                  <q-item-label caption>{{ a.modalidade }}{{ a.unidade_nome ? ` · ${a.unidade_nome}` : '' }}</q-item-label>
                </q-item-section>
                <q-item-section side class="text-right">
                  <div class="text-weight-medium text-dark">{{ brl(a.valor_estimado) }}</div>
                  <div class="text-caption">até {{ dataHora(a.data_encerramento) }}</div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section>
              <BarrasVerticais :itens="o.porMes.map((m) => ({ rotulo: MESES[Number(m.mes.slice(5, 7)) - 1], rotuloLongo: `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)}`, valor: m.valor ?? 0, detalhe: `${m.contratos} contrato(s)` }))"
                :formatar="brlCurto" :altura="180" titulo="Contratado por mês" />
            </q-card-section>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Contratos recentes</q-card-section>
            <q-card-section v-if="!o.recentes.length" class="text-grey-7">Nenhum contrato no histórico do sistema.</q-card-section>
            <q-list v-else separator>
              <q-item v-for="c in o.recentes" :key="c.id" :clickable="!!linkContrato(c.numero_controle_pncp)" @click="abrir(linkContrato(c.numero_controle_pncp))">
                <q-item-section>
                  <q-item-label lines="2">{{ c.objeto }}</q-item-label>
                  <q-item-label caption>{{ c.fornecedor_nome ?? '—' }}</q-item-label>
                </q-item-section>
                <q-item-section side class="text-right"><div class="text-weight-medium text-dark">{{ brl(c.valor_global) }}</div><div class="text-caption">{{ data(c.data_assinatura) }}</div></q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section>
              <div class="text-subtitle1 text-weight-medium">Pagômetro</div>
              <div class="pag q-mt-sm" :class="`pag-${o.pagometro.nivel}`">
                <div class="text-weight-bold">{{ PAG[o.pagometro.nivel] ?? 'Sem nota' }}<span v-if="o.pagometro.nota"> · CAPAG {{ o.pagometro.nota }}</span></div>
                <div class="text-caption">{{ o.pagometro.ente }}</div>
              </div>
              <div class="text-body2 text-grey-8 q-mt-sm">{{ o.pagometro.texto }}</div>
              <div v-if="o.pagometro.observacao" class="text-caption text-grey-7 q-mt-xs">{{ o.pagometro.observacao }}</div>
            </q-card-section>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">De quem mais compra (12 meses)</q-card-section>
            <q-card-section v-if="!o.fornecedores.length" class="text-grey-7">Sem contratos nos últimos 12 meses.</q-card-section>
            <q-list v-else separator>
              <q-item v-for="f in o.fornecedores" :key="f.ni" clickable :to="{ name: 'analise-empresas', params: { cnpj: f.ni } }">
                <q-item-section>
                  <q-item-label lines="1">{{ f.nome }}</q-item-label>
                  <q-item-label caption>{{ f.contratos }} contrato(s) · último em {{ data(f.ultima) }}</q-item-label>
                </q-item-section>
                <q-item-section side class="text-weight-medium text-dark">{{ brlCurto(f.valor) }}</q-item-section>
              </q-item>
            </q-list>
            <q-card-actions>
              <q-btn flat no-caps color="primary" icon="query_stats" label="Ver todos os contratos" :to="{ name: 'historico', query: { aba: 'contratos', orgao: o.cnpj, nome: o.nome } }" />
            </q-card-actions>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from 'boot/axios';
import { brl, cnpj, data, dataHora } from 'src/format';
import BarrasVerticais from 'components/graficos/BarrasVerticais.vue';

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const PAG = { baixo: 'Paga em dia', medio: 'Atenção', alto: 'Risco de atraso', federal: 'Órgão federal', indisponivel: 'Sem nota do Tesouro' };
const route = useRoute();
const o = ref(null);
const erro = ref('');
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const brlCurto = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : brl(v));
const kpis = computed(() => [
  { nome: 'Abertas agora', valor: num(o.value.resumo.abertas) },
  { nome: 'Licitações · 12 meses', valor: num(o.value.resumo.licitacoes12m) },
  { nome: 'Contratos · 12 meses', valor: num(o.value.resumo.contratos12m) },
  { nome: 'Contratado · 12 meses', valor: brlCurto(o.value.resumo.valor12m) },
]);
const abrir = (url) => { if (url) window.open(url, '_blank', 'noopener'); };
function linkContrato(controle) {
  const m = String(controle ?? '').match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
  return m ? `https://pncp.gov.br/app/contratos/${m[1]}/${m[3]}/${m[2]}` : null;
}
async function carregar() {
  o.value = null;
  erro.value = '';
  try {
    o.value = (await api.get(`/orgaos/${route.params.cnpj}`, { silencioso: true })).data;
  } catch {
    erro.value = 'Órgão não encontrado no histórico do sistema.';
  }
}
watch(() => route.params.cnpj, (c) => { if (c) carregar(); });
onMounted(carregar);
</script>

<style scoped>
.pag { border-radius: 10px; padding: 10px 12px; background: rgba(100, 116, 139, 0.1); }
.pag-baixo { background: rgba(34, 197, 94, 0.16); }
.pag-medio { background: rgba(245, 158, 11, 0.18); }
.pag-alto { background: rgba(239, 68, 68, 0.16); }
.pag-federal { background: rgba(59, 130, 246, 0.16); }
</style>

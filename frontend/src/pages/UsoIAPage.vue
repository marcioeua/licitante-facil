<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="paid" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold col">Uso da IA</div>
      <q-select v-model="mes" :options="meses" dense outlined emit-value map-options style="min-width: 170px" @update:model-value="carregar" />
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Quanto a leitura de editais, as perguntas, o chat do pregoeiro e as peças jurídicas custaram, calculado com os tokens de cada uso e os preços oficiais da Anthropic.
    </div>

    <q-skeleton v-if="!p" height="300px" />
    <template v-else>
      <div class="row q-col-gutter-md q-mb-md">
        <div v-for="k in kpis" :key="k.nome" class="col-6 col-md-3">
          <q-card flat bordered class="lf-card full-height">
            <q-card-section>
              <div class="text-caption text-grey-7">{{ k.nome }}</div>
              <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
              <div class="text-caption text-grey-6">{{ k.detalhe }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-12 col-md-8">
          <q-card flat bordered class="lf-card full-height">
            <q-card-section>
              <div class="text-subtitle1 text-weight-medium q-mb-sm">Gasto por dia</div>
              <BarrasVerticais :itens="p.porDia.map((d) => ({ rotulo: d.dia.slice(8, 10), rotuloLongo: data(d.dia), valor: d.usd, detalhe: `${d.usos} uso(s) · ${reais(d.usd)}` }))"
                :formatar="usd" :altura="190" titulo="Gasto por dia" />
            </q-card-section>
          </q-card>
        </div>
        <div class="col-12 col-md-4">
          <q-card flat bordered class="lf-card full-height">
            <q-card-section>
              <div class="text-subtitle1 text-weight-medium q-mb-sm">Limite de gasto mensal</div>
              <div class="text-body2 text-grey-7 q-mb-sm">Ao chegar no limite, o sistema pausa as análises com IA até o mês seguinte (ou até você aumentar o valor).</div>
              <q-input v-model.number="limite" type="number" step="0.5" min="0" outlined dense label="Limite por mês (US$)" :hint="limite ? `≈ ${reais(limite)}` : 'Vazio = sem limite'" />
              <q-input v-model.number="cotacao" type="number" step="0.01" min="0.5" outlined dense label="Cotação do dólar (R$)" class="q-mt-md" />
              <q-btn unelevated no-caps color="primary" label="Salvar" class="q-mt-md" :loading="salvando" @click="salvar" />
              <div v-if="p.usoDoLimite != null" class="q-mt-md">
                <q-linear-progress :value="p.usoDoLimite" rounded size="10px" :color="p.usoDoLimite >= 1 ? 'negative' : p.usoDoLimite >= 0.8 ? 'orange-8' : 'positive'" />
                <div class="text-caption text-grey-7 q-mt-xs">{{ Math.round(p.usoDoLimite * 100) }}% do limite usado neste mês</div>
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <q-card v-if="p.porTipo.length" flat bordered class="lf-card q-mb-md">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium q-mb-sm">Por tipo de uso</div>
          <div v-for="t in p.porTipo" :key="t.nome" class="row items-center q-mb-xs">
            <div class="col-5 col-sm-3 text-body2">{{ t.nome }}</div>
            <div class="col"><div class="barra-tipo" :style="{ width: Math.max(2, (t.usd / maxTipo) * 100) + '%' }" /></div>
            <div class="col-auto text-body2 q-pl-sm" style="min-width: 150px; text-align: right">{{ usd(t.usd) }} · {{ t.usos }}x</div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="lf-card">
        <q-card-section class="text-subtitle1 text-weight-medium">Cada uso</q-card-section>
        <div v-if="!p.itens.length" class="q-pa-md text-grey-7">Nenhum uso da IA neste mês.</div>
        <q-markup-table v-else flat dense separator="horizontal" wrap-cells>
          <thead><tr><th class="text-left">Quando</th><th class="text-left">O quê</th><th class="text-left">Edital / negócio</th><th class="text-right">Tokens</th><th class="text-right">Custo</th></tr></thead>
          <tbody>
            <tr v-for="i in p.itens" :key="i.id">
              <td class="text-left" style="white-space: nowrap">{{ dataHoraBr(i.quando) }}</td>
              <td class="text-left">{{ i.tipoNome }}</td>
              <td class="text-left" style="max-width: 420px">
                <router-link v-if="i.link" :to="i.link" class="text-primary">{{ curto(i.titulo) }}</router-link>
                <span v-else class="text-grey-6">—</span>
                <div v-if="i.detalhe" class="text-caption text-grey-7">{{ i.detalhe }}</div>
              </td>
              <td class="text-right text-caption" style="white-space: nowrap">
                {{ num(i.tokensEntrada) }} lidos<span v-if="i.tokensCache"> · {{ num(i.tokensCache) }} cache</span><br />{{ num(i.tokensSaida) }} escritos
              </td>
              <td class="text-right" style="white-space: nowrap"><b>{{ usd(i.usd) }}</b><div class="text-caption text-grey-7">{{ reais(i.usd) }}</div></td>
            </tr>
          </tbody>
        </q-markup-table>
      </q-card>
      <div class="text-caption text-grey-6 q-mt-sm">
        Preços: Claude Opus 5.5, US$ 4 por milhão de tokens lidos, US$ 20 por milhão escritos e US$ 0,20 por milhão relidos do cache.
        Valores em reais são aproximados pela cotação acima. O valor cobrado oficialmente aparece no Console da Anthropic (Uso e Cobrança).
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Notify } from 'quasar';
import { api } from 'boot/axios';
import { data } from 'src/format';
import BarrasVerticais from 'components/graficos/BarrasVerticais.vue';

const p = ref(null);
const mes = ref(null);
const limite = ref(null);
const cotacao = ref(5.5);
const salvando = ref(false);

const meses = computed(() => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const v = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: v, label: m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) });
  }
  return out;
});
const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const usd = (v) => `US$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 ? 4 : 2 })}`;
const reais = (v) => Number((v ?? 0) * (p.value?.cotacaoDolar ?? cotacao.value)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHoraBr = (s) => new Date(s.replace(' ', 'T')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const curto = (t) => (t && t.length > 110 ? `${t.slice(0, 107)}...` : t);
const maxTipo = computed(() => Math.max(...(p.value?.porTipo ?? []).map((t) => t.usd), 1e-9));
const kpis = computed(() => [
  { nome: 'Hoje', valor: usd(p.value.hoje.usd), detalhe: `${reais(p.value.hoje.usd)} · ${p.value.hoje.usos} uso(s)` },
  { nome: 'No mês', valor: usd(p.value.totalMes.usd), detalhe: `${reais(p.value.totalMes.usd)} · ${p.value.totalMes.usos} uso(s)` },
  { nome: 'Média por edital lido', valor: p.value.mediaPorEdital == null ? '—' : usd(p.value.mediaPorEdital), detalhe: p.value.mediaPorEdital == null ? 'Nenhum edital lido no mês' : `${reais(p.value.mediaPorEdital)} · ${p.value.leiturasEdital} edital(is)` },
  { nome: 'Limite mensal', valor: p.value.limiteMensalUsd == null ? 'Sem limite' : usd(p.value.limiteMensalUsd), detalhe: p.value.limiteMensalUsd == null ? 'Defina ao lado' : reais(p.value.limiteMensalUsd) },
]);

async function carregar() {
  p.value = (await api.get('/ia/uso', { params: mes.value ? { mes: mes.value } : {} })).data;
  mes.value = p.value.mes;
  limite.value = p.value.limiteMensalUsd;
  cotacao.value = p.value.cotacaoDolar;
}
async function salvar() {
  salvando.value = true;
  try {
    await api.put('/ia/config', { limiteMensalUsd: limite.value === '' || limite.value == null ? null : Number(limite.value), cotacaoDolar: Number(cotacao.value) || 5.5 });
    Notify.create({ type: 'positive', message: 'Configuração salva.' });
    await carregar();
  } finally {
    salvando.value = false;
  }
}
onMounted(carregar);
</script>

<style scoped>
.barra-tipo { height: 10px; border-radius: 0 5px 5px 0; background: #2a78d6; }
</style>

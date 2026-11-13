<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="calculate" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Calculadora de preço</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Quanto cobrar sem ter prejuízo, quanto vai de imposto (com DIFAL) e quanto sobra de lucro em cada lance.
      <span v-if="contexto"> · <b>{{ contexto }}</b></span>
    </div>

    <div class="row q-col-gutter-md">
      <!-- ENTRADAS -->
      <div class="col-12 col-md-5 q-gutter-y-md">
        <q-card flat bordered class="lf-card">
          <q-card-section class="q-pb-sm"><div class="text-subtitle1 text-weight-bold"><q-icon name="business" /> Sua empresa</div></q-card-section>
          <q-card-section class="q-pt-none q-gutter-y-sm">
            <q-btn-toggle v-model="e.regime" spread no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9" class="regimes"
              :options="[{ label: 'Simples', value: 'simples' }, { label: 'Presumido', value: 'presumido' }, { label: 'Real', value: 'real' }, { label: 'MEI', value: 'mei' }]" />
            <q-btn-toggle v-model="e.tipo" spread no-caps unelevated toggle-color="teal-7" color="grey-2" text-color="grey-9"
              :options="[{ label: 'Vendo produto', value: 'mercadoria' }, { label: 'Presto serviço', value: 'servico' }]" />
            <div class="row q-col-gutter-sm">
              <div v-if="e.regime === 'simples'" class="col-7">
                <q-input v-model.number="e.rbt12" type="number" outlined dense label="Faturamento últimos 12 meses (R$)" :hint="faixaSimples" />
              </div>
              <div :class="e.regime === 'simples' ? 'col-5' : 'col-6'"><q-select v-model="e.ufOrigem" :options="UFS" outlined dense label="Estado da empresa" /></div>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="lf-card">
          <q-card-section class="q-pb-sm"><div class="text-subtitle1 text-weight-bold"><q-icon name="account_balance" /> A venda</div></q-card-section>
          <q-card-section class="q-pt-none q-gutter-y-sm">
            <div class="row q-col-gutter-sm">
              <div class="col-6"><q-select v-model="e.ufDestino" :options="UFS" outlined dense label="Estado do órgão" /></div>
              <div class="col-6"><q-input v-model.number="quantidade" type="number" outlined dense label="Quantidade" min="1" /></div>
            </div>
            <div v-if="interestadual" class="aviso-difal">
              <div class="text-body2"><q-icon name="swap_horiz" /> Venda para outro estado: ICMS interestadual de <b>{{ (estrut.inter * 100).toFixed(0) }}%</b><span v-if="e.importado"> (produto importado)</span>.</div>
              <q-input v-model.number="e.icmsInternoDestino" type="number" step="any" outlined dense class="q-mt-sm" :label="`ICMS interno de ${e.ufDestino} (%) para o DIFAL`"
                hint="Veja no site da Secretaria da Fazenda do estado; some o Fundo de Pobreza (FCP), se houver." />
            </div>
            <div class="row q-col-gutter-sm">
              <div v-if="e.tipo === 'mercadoria' && foraDoSimples && !interestadual" class="col-6">
                <q-input v-model.number="e.icmsInternoOrigem" type="number" step="any" outlined dense :label="`ICMS interno de ${e.ufOrigem || 'seu estado'} (%)`" />
              </div>
              <div v-if="e.tipo === 'mercadoria' && foraDoSimples" class="col-6">
                <q-input v-model.number="e.icmsCreditoCompra" type="number" step="any" outlined dense label="Crédito de ICMS na compra (%)" hint="O ICMS da nota do seu fornecedor" />
              </div>
              <div v-if="e.tipo === 'servico' && foraDoSimples" class="col-6"><q-input v-model.number="e.issPct" type="number" step="any" outlined dense label="ISS do município (%)" hint="De 2% a 5%" /></div>
            </div>
            <div class="row">
              <q-toggle v-model="e.orgaoFederal" dense label="Órgão federal" class="q-mr-md" />
              <q-toggle v-if="e.tipo === 'mercadoria'" v-model="e.importado" dense label="Produto importado" />
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="lf-card">
          <q-card-section class="q-pb-sm"><div class="text-subtitle1 text-weight-bold"><q-icon name="inventory_2" /> Seus custos por unidade</div></q-card-section>
          <q-card-section class="q-pt-none">
            <div class="row q-col-gutter-sm">
              <div class="col-6"><q-input v-model.number="e.custo" type="number" step="any" outlined dense :label="e.tipo === 'servico' ? 'Custo do serviço (R$)' : 'Custo do produto (R$)'" autofocus /></div>
              <div class="col-6"><q-input v-model.number="e.frete" type="number" step="any" outlined dense label="Frete por unidade (R$)" /></div>
              <div class="col-6"><q-input v-model.number="e.outros" type="number" step="any" outlined dense label="Outros por unidade (R$)" hint="Embalagem, seguro, garantia" /></div>
              <div class="col-6"><q-input v-model.number="e.despesasPct" type="number" step="any" outlined dense label="Despesas sobre o preço (%)" hint="Comissão, taxas, inadimplência" /></div>
            </div>
            <div class="q-mt-md">
              <div class="text-caption text-grey-7">Margem de lucro que você quer: <b class="text-primary">{{ margem }}%</b> (lucro líquido sobre o preço)</div>
              <q-slider v-model="margem" :min="0" :max="60" :step="1" label />
            </div>
            <q-input v-model.number="estimado" type="number" step="any" outlined dense label="Valor estimado pelo órgão, por unidade (R$) — opcional" />
            <q-expansion-item dense dense-toggle icon="tune" label="Opções avançadas" class="q-mt-sm text-grey-8">
              <div class="q-pa-sm q-gutter-y-sm">
                <q-option-group v-model="e.difalMetodo" dense :options="[{ label: 'DIFAL base única (mais comum)', value: 'unica' }, { label: 'DIFAL base dupla (ICMS por dentro)', value: 'dupla' }]" />
                <q-toggle v-if="e.regime === 'simples'" v-model="e.difalNoSimples" dense label="Meu estado cobra DIFAL do Simples mesmo assim" />
              </div>
            </q-expansion-item>
          </q-card-section>
        </q-card>
      </div>

      <!-- RESULTADOS -->
      <div id="resultados" class="col-12 col-md-7 q-gutter-y-md">
        <div v-if="!(e.custo > 0)" class="lf-card q-pa-lg text-center text-grey-7 bg-white vazio">
          <q-icon name="calculate" size="48px" color="grey-5" /><br />Coloque o <b>custo do produto</b> para ver o preço mínimo, os impostos e o seu lucro.
        </div>
        <template v-else>
          <div class="row q-col-gutter-sm">
            <div class="col-12 col-sm-4"><div class="kpi kpi-min"><div class="rot">Preço mínimo (sem prejuízo)</div><div class="big">{{ brl(minimo) }}</div><div class="sub">abaixo disso você paga para vender</div></div></div>
            <div class="col-12 col-sm-4"><div class="kpi kpi-alvo"><div class="rot">Preço com {{ margem }}% de lucro</div><div class="big">{{ brl(alvo) }}</div><div class="sub">lucro de {{ brl(analiseAlvo?.lucro) }} por unidade</div></div></div>
            <div class="col-12 col-sm-4"><div class="kpi"><div class="rot">Lucro total ({{ num(quantidade) }} un.)</div><div class="big text-positive">{{ brlL(analiseAlvo?.total.lucro) }}</div><div class="sub">venda de {{ brl(analiseAlvo?.total.venda) }}</div></div></div>
          </div>

          <q-banner v-if="estimado > 0 && minimo" rounded :class="minimo > estimado ? 'bg-red-1 text-red-10' : alvo > estimado ? 'bg-orange-1 text-orange-10' : 'bg-green-1 text-green-10'">
            <template #avatar><q-icon :name="minimo > estimado ? 'block' : alvo > estimado ? 'warning' : 'thumb_up'" /></template>
            <span v-if="minimo > estimado"><b>Não compensa:</b> seu preço mínimo ({{ brl(minimo) }}) já está {{ pctTxt(minimo / estimado - 1) }} acima do estimado pelo órgão ({{ brl(estimado) }}).</span>
            <span v-else-if="alvo > estimado"><b>Dá para participar, com margem menor:</b> no estimado ({{ brl(estimado) }}) seu lucro seria de {{ pctTxt(analiseEstimado.margem) }}. Para ter {{ margem }}% precisaria de {{ brl(alvo) }}.</span>
            <span v-else><b>Boa:</b> você tem espaço para disputar de {{ brl(estimado) }} (lucro de {{ pctTxt(analiseEstimado.margem) }}) até {{ brl(minimo) }} (sem lucro).</span>
          </q-banner>

          <q-card flat bordered class="lf-card">
            <q-card-section class="row items-center q-pb-sm">
              <div class="col text-subtitle1 text-weight-bold"><q-icon name="pie_chart" /> Para onde vai o dinheiro</div>
              <div style="width: 170px"><q-input v-model.number="precoTeste" type="number" step="any" outlined dense label="Testar o preço (R$)" :placeholder="alvo ? alvo.toFixed(2) : ''" /></div>
            </q-card-section>
            <q-card-section class="q-pt-none">
              <div class="barra">
                <div v-for="s in segmentos" :key="s.nome" class="seg" :style="{ width: `${s.pct}%`, background: s.cor }"><q-tooltip>{{ s.nome }}: {{ brl(s.rs) }} ({{ s.pct.toFixed(1) }}%)</q-tooltip></div>
              </div>
              <div class="row q-gutter-x-md q-mt-xs text-caption">
                <span v-for="s in segmentos" :key="s.nome"><span class="ponto" :style="{ background: s.cor }" /> {{ s.nome }} {{ s.pct.toFixed(0) }}%</span>
              </div>
              <q-markup-table flat dense class="q-mt-sm tabela">
                <tbody>
                  <tr><td>Preço de venda</td><td class="text-right text-weight-bold">{{ brl(analise.preco) }}</td></tr>
                  <tr><td>(−) Custo {{ e.tipo === 'servico' ? 'do serviço' : 'do produto' }}</td><td class="text-right">{{ brl(e.custo) }}</td></tr>
                  <tr v-for="(i, k) in analise.itens" :key="k" :class="{ 'text-positive': i.rs < 0 }">
                    <td>{{ i.rs < 0 ? '(+)' : '(−)' }} {{ i.nome }}</td><td class="text-right">{{ brl(Math.abs(i.rs)) }}</td>
                  </tr>
                  <tr class="total" :class="analise.lucro >= 0 ? 'text-positive' : 'text-negative'">
                    <td>= {{ analise.lucro >= -0.005 ? 'Lucro líquido' : 'Prejuízo' }} por unidade</td>
                    <td class="text-right">{{ brlL(analise.lucro) }} <span class="text-caption">({{ pctTxt(analise.margem) }})</span></td>
                  </tr>
                  <tr><td class="text-grey-7">Total de impostos por unidade</td><td class="text-right text-grey-7">{{ brl(analise.impostos) }} ({{ pctTxt(analise.preco ? analise.impostos / analise.preco : 0) }} do preço)</td></tr>
                  <tr v-if="analise.markup"><td class="text-grey-7">Markup (preço ÷ custo)</td><td class="text-right text-grey-7">{{ analise.markup.toFixed(2).replace('.', ',') }}×</td></tr>
                </tbody>
              </q-markup-table>
              <div v-if="analise.retencao" class="text-caption text-blue-9 q-mt-sm">
                <q-icon name="info" /> Órgão federal retém <b>{{ brl(analise.retencao) }}</b> por unidade (5,85%: IR, CSLL, PIS e COFINS) no pagamento. Não é custo a mais:
                é imposto pago antes, que você desconta depois. Mas entra menos dinheiro no caixa na hora.
              </div>
            </q-card-section>
          </q-card>

          <q-card v-if="lances.length" flat bordered class="lf-card">
            <q-card-section class="q-pb-sm">
              <div class="text-subtitle1 text-weight-bold"><q-icon name="gavel" /> Tabela de lances</div>
              <div class="text-caption text-grey-7">Do {{ estimado > 0 ? 'estimado pelo órgão' : 'preço com margem' }} até o seu preço mínimo: quanto você ganha em cada lance.</div>
            </q-card-section>
            <q-markup-table flat dense class="tabela">
              <thead><tr><th class="text-left">Lance</th><th class="text-right">Lucro por un.</th><th class="text-right">Margem</th><th class="text-right">Lucro total</th></tr></thead>
              <tbody>
                <tr v-for="l in lances" :key="l.preco" :class="{ 'text-negative': l.lucro < 0, 'linha-alvo': Math.abs(l.margem * 100 - margem) < 1 }">
                  <td>{{ brl(l.preco) }}</td><td class="text-right">{{ brlL(l.lucro) }}</td>
                  <td class="text-right"><q-linear-progress :value="Math.max(0, Math.min(1, l.margem / 0.4))" :color="l.margem < 0.05 ? 'orange' : 'positive'" size="6px" rounded class="barra-margem" /> {{ pctTxt(l.margem) }}</td>
                  <td class="text-right">{{ brlL(l.lucro * (quantidade || 1)) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="q-pb-sm">
              <div class="text-subtitle1 text-weight-bold"><q-icon name="compare_arrows" /> E se fosse outro regime?</div>
              <div class="text-caption text-grey-7">Mesmo custo e mesma venda, comparando o preço mínimo e o lucro em {{ brl(analise.preco) }}.</div>
            </q-card-section>
            <q-markup-table flat dense class="tabela">
              <thead><tr><th class="text-left">Regime</th><th class="text-right">Preço mínimo</th><th class="text-right">Impostos no preço</th><th class="text-right">Lucro em {{ brl(analise.preco) }}</th></tr></thead>
              <tbody>
                <tr v-for="r in comparacao" :key="r.regime" :class="{ 'text-weight-bold': r.regime === e.regime }">
                  <td>{{ r.nome }}<span v-if="r.regime === 'simples' && !e.rbt12" class="text-caption text-grey-6"> (1ª faixa: informe o faturamento)</span><q-badge v-if="r.melhor" color="positive" class="q-ml-xs" label="menor preço" /></td>
                  <td class="text-right">{{ brl(r.minimo) }}</td><td class="text-right">{{ pctTxt(r.impostosPct) }}</td>
                  <td class="text-right" :class="r.lucro < 0 ? 'text-negative' : ''">{{ brlL(r.lucro) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
            <q-card-section class="text-caption text-grey-6 q-pt-sm">Mudar de regime depende do faturamento e de outras despesas da empresa: use como conversa com seu contador.</q-card-section>
          </q-card>

          <div v-if="itemId" class="row justify-end">
            <q-btn unelevated no-caps color="primary" icon="gavel" :label="`Usar ${brl(alvo)} como preço mínimo na Sala de disputa`" :loading="aplicando" @click="aplicarNaSala" />
          </div>

          <q-card flat bordered class="lf-card">
            <q-card-section class="text-caption text-grey-8 q-gutter-y-xs">
              <div v-for="(a, k) in analise.avisos" :key="k"><q-icon name="info" color="orange-8" /> {{ a }}</div>
              <div><q-icon name="event" color="blue-8" /> Reforma tributária: em 2026 a nota já mostra CBS (0,9%) e IBS (0,1%) em caráter de teste, compensados com PIS/COFINS, sem custo extra. A troca para valer começa em 2027.</div>
              <div class="text-grey-6">Regras usadas: LC 123/2006 (Simples), presunção do Lucro Presumido, Resoluções do Senado 22/1989 e 13/2012 (ICMS interestadual), EC 87/2015 e LC 190/2022 (DIFAL), IN RFB 1.234/2012 (retenção). É uma estimativa: confirme com seu contador.</div>
            </q-card-section>
          </q-card>
        </template>
      </div>
    </div>
    <!-- Celular: resumo sempre à vista enquanto digita -->
    <div v-if="e.custo > 0 && minimo && $q.screen.lt.md" class="resumo-celular row items-center no-wrap" @click="verResultados">
      <div class="col"><div class="rot">Mínimo</div><div class="val">{{ brl(minimo) }}</div></div>
      <div class="col"><div class="rot">Com {{ margem }}%</div><div class="val">{{ brl(alvo) }}</div></div>
      <q-icon name="expand_more" size="24px" />
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { UFS, aliquotaSimples, estrutura, precoParaMargem, analisarPreco, tabelaDeLances } from 'src/calculadora';

const $q = useQuasar();
const route = useRoute();
const GUARDAR = ['regime', 'tipo', 'rbt12', 'ufOrigem', 'icmsInternoOrigem', 'icmsCreditoCompra', 'issPct', 'despesasPct', 'difalMetodo', 'difalNoSimples'];
const e = reactive({
  regime: 'simples', tipo: 'mercadoria', rbt12: null, ufOrigem: null, ufDestino: null, importado: false, orgaoFederal: false,
  icmsInternoOrigem: null, icmsInternoDestino: null, icmsCreditoCompra: null, issPct: null,
  custo: null, frete: null, outros: null, despesasPct: null, difalMetodo: 'unica', difalNoSimples: false,
});
const margem = ref(15);
const quantidade = ref(1);
const estimado = ref(null);
const precoTeste = ref(null);
const contexto = ref('');
const itemId = ref(null);
const aplicando = ref(false);
// Dados da empresa ficam guardados neste aparelho (não precisa digitar de novo).
try { Object.assign(e, JSON.parse(localStorage.getItem('calculadora.empresa') ?? '{}')); margem.value = Number(localStorage.getItem('calculadora.margem') ?? 15); } catch { /* sem armazenamento */ }
watch([() => GUARDAR.map((k) => e[k]), margem], () => {
  try { localStorage.setItem('calculadora.empresa', JSON.stringify(Object.fromEntries(GUARDAR.map((k) => [k, e[k]])))); localStorage.setItem('calculadora.margem', String(margem.value)); } catch { /* sem armazenamento */ }
}, { deep: true });

const brl = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 4 : 2 }));
// Lucro e totais: 2 casas, e quase zero vira zero.
const brlL = (v) => (v == null || !Number.isFinite(v) ? '—' : (Math.abs(v) < 0.005 ? 0 : v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const pctTxt = (v) => `${((v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const foraDoSimples = computed(() => e.regime === 'presumido' || e.regime === 'real');
const estrut = computed(() => estrutura(e));
const interestadual = computed(() => e.tipo === 'mercadoria' && estrut.value.inter != null && e.regime !== 'mei');
const faixaSimples = computed(() => {
  const s = aliquotaSimples(e.tipo === 'servico' ? 'III' : 'I', e.rbt12);
  return `Alíquota efetiva: ${pctTxt(s.efetiva)} (faixa ${s.faixa})`;
});
const minimo = computed(() => precoParaMargem(e, 0));
const alvo = computed(() => precoParaMargem(e, margem.value));
const analiseAlvo = computed(() => (alvo.value ? analisarPreco(e, alvo.value, quantidade.value) : null));
const analiseEstimado = computed(() => analisarPreco(e, estimado.value || 0));
const analise = computed(() => analisarPreco(e, precoTeste.value || alvo.value || 0, quantidade.value));
const CORES = { custo: '#64748b', imposto: '#ef4444', difal: '#f97316', despesa: '#a855f7', lucro: '#22c55e', credito: '#14b8a6' };
const segmentos = computed(() => {
  const a = analise.value;
  if (!a.preco) return [];
  const imp = a.itens.filter((i) => !i.despesa && !/DIFAL/.test(i.nome)).reduce((s, i) => s + i.rs, 0);
  const difal = a.itens.filter((i) => /DIFAL/.test(i.nome)).reduce((s, i) => s + i.rs, 0);
  const desp = a.itens.filter((i) => i.despesa).reduce((s, i) => s + i.rs, 0);
  const lista = [
    { nome: 'Custo', rs: Number(e.custo) || 0, cor: CORES.custo },
    { nome: 'Impostos', rs: imp, cor: CORES.imposto },
    { nome: 'DIFAL', rs: difal, cor: CORES.difal },
    { nome: 'Frete e despesas', rs: desp, cor: CORES.despesa },
    { nome: 'Lucro', rs: a.lucro, cor: CORES.lucro },
  ].filter((s) => s.rs > 0.0001);
  const total = lista.reduce((s, x) => s + x.rs, 0);
  return lista.map((s) => ({ ...s, pct: (s.rs / total) * 100 }));
});
const lances = computed(() => {
  if (!minimo.value) return [];
  const topo = estimado.value > minimo.value ? estimado.value : (alvo.value ?? minimo.value) * 1.15;
  return tabelaDeLances(e, topo, minimo.value, 8);
});
const comparacao = computed(() => {
  const nomes = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' };
  const p = analise.value.preco;
  const lista = Object.entries(nomes).map(([regime, nome]) => {
    const x = { ...e, regime };
    const r = analisarPreco(x, p);
    return { regime, nome, minimo: precoParaMargem(x, 0), lucro: r.lucro, impostosPct: p ? r.impostos / p : 0 };
  });
  const menor = Math.min(...lista.map((r) => r.minimo ?? Infinity));
  return lista.map((r) => ({ ...r, melhor: r.minimo === menor }));
});

function verResultados() { document.getElementById('resultados')?.scrollIntoView({ behavior: 'smooth' }); }
async function aplicarNaSala() {
  aplicando.value = true;
  try {
    // Na Sala, preço mínimo = custo × (1 + margem): custo = preço sem lucro (já com impostos) e a margem leva ao preço alvo.
    await api.patch(`/disputa/itens/${itemId.value}`, { custo: Math.round(minimo.value * 100) / 100, margem_minima: alvo.value / minimo.value - 1 });
    $q.notify({ type: 'positive', message: `Pronto: o preço mínimo do item na Sala de disputa agora é ${brl(alvo.value)}.` });
  } finally {
    aplicando.value = false;
  }
}

onMounted(async () => {
  const q = route.query;
  if (q.custo) e.custo = Number(q.custo);
  if (q.qtd) quantidade.value = Number(q.qtd) || 1;
  if (q.estimado) estimado.value = Number(q.estimado);
  if (q.uf) e.ufDestino = String(q.uf);
  if (q.federal === '1') e.orgaoFederal = true;
  if (q.item) itemId.value = Number(q.item);
  if (q.descricao) contexto.value = String(q.descricao).slice(0, 120);
  if (q.oportunidade) {
    try {
      const op = (await api.get(`/oportunidades/${q.oportunidade}`, { silencioso: true })).data;
      e.ufDestino = op.uf ?? e.ufDestino;
      e.orgaoFederal = op.esfera === 'F';
      contexto.value = `${op.orgao_nome ?? ''}${op.uf ? ` (${op.uf})` : ''}`;
    } catch { /* licitação não encontrada */ }
  }
});
</script>

<style scoped>
.regimes :deep(.q-btn) { padding: 6px 4px; }
.aviso-difal { border-radius: 8px; padding: 8px 10px; background: rgba(249, 115, 22, 0.1); }
.kpi { border-radius: 12px; padding: 12px 14px; background: rgba(100, 116, 139, 0.08); height: 100%; }
.kpi-min { background: rgba(239, 68, 68, 0.1); }
.kpi-alvo { background: rgba(29, 78, 216, 0.1); }
.kpi .rot { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
.kpi .big { font-size: 24px; font-weight: 800; line-height: 1.2; margin-top: 2px; }
.kpi .sub { font-size: 12px; color: #6b7280; }
.barra { display: flex; height: 22px; border-radius: 6px; overflow: hidden; }
.seg { height: 100%; transition: width .3s; }
.ponto { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: middle; }
.tabela { background: transparent; }
.tabela tr.total td { font-weight: 800; border-top: 2px solid rgba(100, 116, 139, 0.4); }
.linha-alvo { background: rgba(29, 78, 216, 0.08); }
.barra-margem { display: inline-block; width: 50px; vertical-align: middle; margin-right: 6px; }
.resumo-celular { position: fixed; left: 12px; right: 84px; bottom: 16px; z-index: 2000; background: #1d4ed8; color: #fff; border-radius: 14px; padding: 8px 14px; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
.resumo-celular .rot { font-size: 10px; text-transform: uppercase; opacity: .85; }
.resumo-celular .val { font-weight: 800; font-size: 16px; }
.vazio { border: 1px dashed rgba(100, 116, 139, 0.4); }
.body--dark .vazio { background: transparent !important; }
</style>

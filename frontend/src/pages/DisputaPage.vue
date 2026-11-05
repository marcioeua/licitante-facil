<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Voltar ao negócio" class="q-mb-sm" :to="{ name: 'negocio', params: { id: route.params.id } }" />
    <q-skeleton v-if="!sala" height="300px" />
    <template v-else>
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row items-start q-col-gutter-md">
          <div class="col-12 col-md">
            <div class="row items-center q-gutter-x-sm">
              <q-icon name="gavel" color="primary" size="26px" />
              <div class="text-h6 text-weight-bold">Sala de disputa</div>
            </div>
            <div class="text-subtitle1 q-mt-xs">{{ sala.negocio.titulo }}</div>
            <div v-if="sala.negocio.orgao_nome" class="text-grey-7 text-body2">
              {{ sala.negocio.orgao_nome }} · {{ sala.negocio.municipio }}/{{ sala.negocio.uf }}
              <span v-if="sala.negocio.modalidade"> · {{ sala.negocio.modalidade }}</span>
              <span v-if="sala.negocio.numero_compra"> Nº {{ sala.negocio.numero_compra }}/{{ sala.negocio.ano_compra }}</span>
            </div>
            <div v-if="dataSessao" class="text-body2 q-mt-xs"><q-icon name="event" /> Sessão: <b>{{ dataHora(dataSessao) }}</b></div>
          </div>
          <div class="col-12 col-md-auto row q-gutter-sm items-start">
            <q-btn v-if="sala.negocio.link_origem" outline no-caps color="primary" icon="open_in_new" label="Abrir no portal" :href="sala.negocio.link_origem" target="_blank" rel="noopener" />
            <q-btn v-if="sala.negocio.numero_controle_pncp" outline no-caps color="primary" icon="download" label="Importar itens do PNCP" :loading="importando" @click="importar" />
            <q-btn outline no-caps color="primary" icon="add" label="Adicionar item" @click="novoItem" />
          </div>
        </q-card-section>
        <q-banner dense class="bg-blue-1 text-blue-10">
          <template #avatar><q-icon name="info" /></template>
          Você dá os lances no portal. Aqui você define o <b>preço mínimo</b> de cada item e, durante a sessão, digita o melhor lance da sala:
          o sistema calcula o próximo lance e avisa a hora de <b>parar</b>. Nada é enviado ao portal.
        </q-banner>
      </q-card>

      <template v-if="true">
        <div class="row items-center q-mb-md q-gutter-sm">
          <q-btn-toggle v-model="modo" no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9"
            :options="[{ label: '1. Preparar preços', value: 'preparar', icon: 'calculate' }, { label: '2. Modo disputa', value: 'disputa', icon: 'bolt' }, { label: '3. Chat do pregoeiro', value: 'chat', icon: 'campaign' }]" />
          <q-space />
          <div v-if="sala.itens.length && modo !== 'chat'" class="text-body2 text-grey-8">
            {{ resumo.comMinimo }} de {{ sala.itens.length }} itens com preço mínimo
            <span v-if="resumo.totalMinimo"> · total mínimo {{ brl2(resumo.totalMinimo) }}</span>
          </div>
        </div>

        <div v-if="modo !== 'chat' && !sala.itens.length" class="text-center text-grey-7 q-pa-xl">
          <q-icon name="inventory_2" size="48px" class="q-mb-sm" /><div>Nenhum item ainda.</div>
          <div class="text-body2">Importe os itens do PNCP ou adicione manualmente.</div>
        </div>

        <!-- 1. Preparar -->
        <div v-else-if="modo === 'preparar'" class="q-gutter-y-md">
          <q-card v-for="i in sala.itens" :key="i.id" flat bordered class="lf-card disp-item">
            <q-card-section class="row items-start no-wrap q-pb-sm">
              <div class="col">
                <div class="text-subtitle1 text-weight-bold">{{ i.numero_item ? `Item ${i.numero_item} — ` : '' }}{{ titulo(i.descricao) }}</div>
                <div v-if="i.descricao.trim() !== titulo(i.descricao)" class="text-caption text-grey-7 ellipsis-2-lines">{{ i.descricao }}</div>
                <div class="text-body2 q-mt-xs">
                  <span v-if="i.quantidade">{{ num(i.quantidade) }} {{ i.unidade || 'un.' }}</span>
                  <span v-if="i.valor_estimado"> · estimado pelo órgão <b>{{ brl2(i.valor_estimado) }}</b> por unidade</span>
                </div>
              </div>
              <q-btn flat round dense icon="query_stats" color="primary" @click="abrirPrecos(i)"><q-tooltip>Preços pagos em compras parecidas</q-tooltip></q-btn>
              <q-btn flat round dense icon="delete_outline" color="grey-7" @click="remover(i)"><q-tooltip>Remover item</q-tooltip></q-btn>
            </q-card-section>
            <q-card-section class="row q-col-gutter-sm q-pt-none">
              <div class="col-6 col-sm-3"><q-input :model-value="i.custo" type="number" step="any" min="0" dense outlined label="Seu custo unit. (R$)" hint="Produto + frete + impostos" @change="(v) => salvar(i, { custo: numOuNulo(v) })" /></div>
              <div class="col-6 col-sm-2"><q-input :model-value="i.margem_minima == null ? null : round(i.margem_minima * 100)" type="number" step="any" dense outlined label="Margem mínima %" @change="(v) => salvar(i, { margem_minima: v === '' ? null : Number(v) / 100 })" /></div>
              <div class="col-6 col-sm-2"><q-input :model-value="i.lance_inicial" type="number" step="any" min="0" dense outlined label="Lance inicial (R$)" :hint="i.valor_estimado ? 'Vazio = estimado' : ''" @change="(v) => salvar(i, { lance_inicial: numOuNulo(v) })" /></div>
              <div class="col-6 col-sm-3">
                <q-input :model-value="i.decremento_tipo === 'pct' && i.decremento != null ? round(i.decremento * 100) : i.decremento" type="number" step="any" min="0" dense outlined
                  :label="i.decremento_tipo === 'pct' ? 'Reduzir a cada lance (%)' : 'Reduzir a cada lance (R$)'" hint="Intervalo mínimo do edital"
                  @change="(v) => salvar(i, { decremento: v === '' ? null : i.decremento_tipo === 'pct' ? Number(v) / 100 : Number(v) })">
                  <template #append>
                    <q-btn flat dense no-caps size="sm" :label="i.decremento_tipo === 'pct' ? '%' : 'R$'" @click="salvar(i, { decremento_tipo: i.decremento_tipo === 'pct' ? 'valor' : 'pct', decremento: null })" />
                  </template>
                </q-input>
              </div>
              <div class="col-12 col-sm-2">
                <div class="minimo-box" :class="i.preco_minimo == null ? 'bg-grey-2' : 'bg-green-1'">
                  <div class="text-caption text-grey-7">Preço mínimo</div>
                  <div class="text-subtitle1 text-weight-bold">{{ i.preco_minimo == null ? '—' : brl2(i.preco_minimo) }}</div>
                  <div v-if="folga(i) != null" class="text-caption" :class="folga(i) < 0 ? 'text-negative' : 'text-grey-7'">
                    {{ folga(i) < 0 ? 'acima do estimado' : `${pct(folga(i))} abaixo do estimado` }}
                  </div>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <!-- 3. Chat do pregoeiro -->
        <ChatPregoeiro v-else-if="modo === 'chat'" :negocio-id="Number(route.params.id)" :tem-empresa="!!sala.negocio.empresa_id" />

        <!-- 2. Modo disputa -->
        <div v-else class="row q-col-gutter-md">
          <div v-for="i in sala.itens" :key="i.id" class="col-12 col-md-6">
            <q-card flat bordered class="lf-card full-height disp-lance" :class="`borda-${i.sugestao.estado}`">
              <q-card-section class="row items-start no-wrap q-pb-xs">
                <div class="col">
                  <div class="text-subtitle1 text-weight-bold">{{ i.numero_item ? `Item ${i.numero_item} — ` : '' }}{{ titulo(i.descricao) }}</div>
                  <div class="text-caption text-grey-7">
                    {{ i.quantidade ? `${num(i.quantidade)} ${i.unidade || 'un.'} · ` : '' }}mínimo {{ i.preco_minimo == null ? 'não definido' : brl2(i.preco_minimo) }}
                  </div>
                </div>
                <q-btn-dropdown flat dense no-caps size="sm" :label="SITUACOES[i.situacao]" :color="i.situacao === 'ganho' ? 'positive' : 'grey-8'">
                  <q-list dense>
                    <q-item v-for="(nome, v) in SITUACOES" :key="v" v-close-popup clickable @click="salvar(i, { situacao: v })"><q-item-section>{{ nome }}</q-item-section></q-item>
                  </q-list>
                </q-btn-dropdown>
              </q-card-section>
              <q-card-section class="row q-col-gutter-sm items-center q-pt-xs">
                <div class="col-6">
                  <div class="text-caption text-grey-7">Melhor lance da sala</div>
                  <div class="text-h6 text-weight-bold">{{ i.melhor_lance == null ? '—' : brl2(i.melhor_lance) }}</div>
                  <div v-if="i.meu_lance != null" class="text-caption">Seu último: {{ brl2(i.meu_lance) }}</div>
                </div>
                <div class="col-6">
                  <q-input v-model="digitado[i.id]" type="number" step="any" min="0" dense outlined label="Novo melhor lance" hint="Digite e aperte Enter"
                    :disable="i.sugestao.estado === 'encerrado'" @keyup.enter="registrar(i, 'melhor', digitado[i.id])" />
                </div>
              </q-card-section>
              <q-card-section class="q-pt-none">
                <div class="sugestao" :class="`sug-${i.sugestao.estado}`">
                  <div class="row items-center no-wrap">
                    <div class="col">
                      <div class="text-caption text-weight-medium">{{ ROTULO[i.sugestao.estado] }}</div>
                      <div v-if="i.sugestao.valor != null" class="text-h5 text-weight-bold">{{ brl2(i.sugestao.valor) }}</div>
                      <div class="text-caption">{{ i.sugestao.mensagem }}</div>
                    </div>
                    <div v-if="i.sugestao.valor != null && ['cobrir', 'inicial'].includes(i.sugestao.estado)" class="column q-gutter-xs">
                      <q-btn unelevated dense no-caps color="primary" icon="content_copy" label="Copiar" @click="copiar(i.sugestao.valor)" />
                      <q-btn outline dense no-caps color="primary" icon="check" label="Dei este lance" @click="registrar(i, 'meu', i.sugestao.valor)" />
                    </div>
                  </div>
                </div>
              </q-card-section>
              <q-card-actions class="q-pt-none">
                <q-btn flat dense no-caps size="sm" icon="edit" label="Dei outro valor" @click="outroValor(i)" />
                <q-btn v-if="i.lances.length" flat dense no-caps size="sm" icon="undo" label="Desfazer último" @click="desfazer(i)" />
                <q-space />
                <q-btn v-if="i.lances.length" flat dense no-caps size="sm" icon="history" :label="`${i.lances.length} registro(s)`">
                  <q-menu><q-list dense style="min-width: 220px">
                    <q-item v-for="(l, k) in i.lances" :key="k"><q-item-section>{{ l.tipo === 'meu' ? 'Meu lance' : 'Melhor da sala' }}</q-item-section>
                      <q-item-section side>{{ brl2(l.valor) }}<div class="text-caption">{{ hora(l.criado_em) }}</div></q-item-section></q-item>
                  </q-list></q-menu>
                </q-btn>
              </q-card-actions>
            </q-card>
          </div>
        </div>
      </template>
    </template>

    <!-- Preços pagos -->
    <q-dialog v-model="dlgPrecos">
      <q-card style="width: 760px; max-width: 95vw">
        <q-card-section class="row items-center">
          <div class="col"><div class="text-h6">Preços pagos em compras parecidas</div><div class="text-caption text-grey-7">Itens homologados no PNCP (fonte oficial)</div></div>
          <q-btn flat round icon="close" v-close-popup />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input v-model="precoQ" dense outlined label="Buscar por" @keyup.enter="buscarPrecos"><template #append><q-btn flat dense icon="search" @click="buscarPrecos" /></template></q-input>
        </q-card-section>
        <q-card-section v-if="carregandoPrecos" class="row items-center q-gutter-sm text-grey-7"><q-spinner-dots color="primary" size="24px" /><span>Consultando o PNCP...</span></q-card-section>
        <template v-else-if="precos">
          <q-card-section v-if="!precos.grupos.length" class="text-grey-7">Nenhum preço homologado encontrado. Tente palavras mais curtas (ex.: "detergente").</q-card-section>
          <q-card-section v-else class="q-pt-none">
            <q-markup-table flat dense separator="horizontal" class="q-mb-md">
              <thead><tr><th class="text-left">Unidade</th><th class="text-right">Compras</th><th class="text-right">Menor</th><th class="text-right">Mediana</th><th class="text-right">Maior</th></tr></thead>
              <tbody><tr v-for="g in precos.grupos.slice(0, 5)" :key="g.unidade"><td>{{ g.unidade }}</td><td class="text-right">{{ g.quantidade }}</td><td class="text-right">{{ brl2(g.minimo) }}</td><td class="text-right text-weight-bold">{{ brl2(g.mediana) }}</td><td class="text-right">{{ brl2(g.maximo) }}</td></tr></tbody>
            </q-markup-table>
            <q-list dense separator>
              <q-item v-for="(p, k) in precos.itens" :key="k">
                <q-item-section><q-item-label lines="2">{{ p.descricao }}</q-item-label><q-item-label caption>{{ p.orgao || '—' }} · {{ p.uf }} · {{ data(p.data) }} · {{ p.fornecedor }}</q-item-label></q-item-section>
                <q-item-section side><div class="text-weight-bold text-dark">{{ brl2(p.valorUnitario) }}</div><div class="text-caption">{{ p.unidade }}</div></q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </template>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar, copyToClipboard, Notify } from 'quasar';
import { api } from 'boot/axios';
import { data, dataHora } from 'src/format';
import ChatPregoeiro from 'components/ChatPregoeiro.vue';

const SITUACOES = { pendente: 'Aguardando', disputando: 'Disputando', ganho: 'Ganhei', perdido: 'Perdi', desisti: 'Desisti' };
const ROTULO = { inicial: 'LANCE INICIAL', cobrir: 'PRÓXIMO LANCE', parar: 'PARE AQUI', ganhando: 'VOCÊ ESTÁ GANHANDO', abaixo_minimo: 'ATENÇÃO', sem_dados: 'FALTAM DADOS', encerrado: 'ENCERRADO' };

const route = useRoute();
const $q = useQuasar();
const sala = ref(null);
const modo = ref('preparar');
const importando = ref(false);
const digitado = ref({});
const dlgPrecos = ref(false);
const precoQ = ref('');
const precoItem = ref(null);
const precos = ref(null);
const carregandoPrecos = ref(false);

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const round = (v) => Math.round(v * 100) / 100;
const pct = (v) => `${(Math.floor(v * 100)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const numOuNulo = (v) => (v === '' || v == null ? null : Number(v));
const hora = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const titulo = (d) => {
  const t = String(d ?? '').split(/\s+(?:material|tipo|modelo|características?|especificações?)\s*:|[,;:]/i)[0].trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
};
const folga = (i) => (i.preco_minimo != null && i.valor_estimado ? (i.valor_estimado - i.preco_minimo) / i.valor_estimado : null);
const dataSessao = computed(() => sala.value?.negocio.data_disputa || sala.value?.negocio.data_encerramento || sala.value?.negocio.data_abertura || null);
const resumo = computed(() => {
  const its = sala.value?.itens ?? [];
  const com = its.filter((i) => i.preco_minimo != null);
  return { comMinimo: com.length, totalMinimo: com.reduce((s, i) => s + i.preco_minimo * (i.quantidade ?? 1), 0) };
});

async function carregar() {
  sala.value = (await api.get(`/disputa/negocio/${route.params.id}`)).data;
  if (sala.value.itens.some((i) => i.situacao !== 'pendente')) modo.value = 'disputa';
}
const trocar = (novo) => {
  const k = sala.value.itens.findIndex((x) => x.id === novo.id);
  if (k >= 0) sala.value.itens[k] = novo;
};
async function salvar(i, campos) {
  trocar((await api.patch(`/disputa/itens/${i.id}`, campos)).data);
}
async function registrar(i, tipo, valor) {
  const v = Number(String(valor ?? '').replace(',', '.'));
  if (!(v > 0)) return;
  trocar((await api.post(`/disputa/itens/${i.id}/lances`, { tipo, valor: v })).data);
  if (tipo === 'melhor') digitado.value[i.id] = '';
}
async function desfazer(i) {
  trocar((await api.delete(`/disputa/itens/${i.id}/lances/ultimo`)).data);
}
function outroValor(i) {
  $q.dialog({ title: 'Qual lance você deu?', prompt: { model: '', type: 'number', outlined: true }, cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Registrar', unelevated: true } })
    .onOk((v) => registrar(i, 'meu', v));
}
async function copiar(v) {
  await copyToClipboard(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }));
  Notify.create({ type: 'positive', message: 'Valor copiado. Cole no portal.', timeout: 1200 });
}
async function importar() {
  importando.value = true;
  try {
    const r = (await api.post(`/disputa/negocio/${route.params.id}/importar`)).data;
    Notify.create({ type: 'positive', message: r.importados ? `${r.importados} item(ns) importado(s).` : 'Todos os itens já estavam na sala.' });
    await carregar();
  } finally {
    importando.value = false;
  }
}
function novoItem() {
  $q.dialog({ title: 'Novo item', message: 'Descrição do item', prompt: { model: '', type: 'text', outlined: true }, cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Adicionar', unelevated: true } })
    .onOk(async (d) => {
      if (!String(d).trim()) return;
      sala.value.itens.push((await api.post(`/disputa/negocio/${route.params.id}/itens`, { descricao: String(d).trim() })).data);
    });
}
function remover(i) {
  $q.dialog({ title: 'Remover item?', message: titulo(i.descricao), cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Remover', color: 'negative', unelevated: true } })
    .onOk(async () => {
      await api.delete(`/disputa/itens/${i.id}`);
      sala.value.itens = sala.value.itens.filter((x) => x.id !== i.id);
    });
}
function abrirPrecos(i) {
  precoItem.value = i;
  precoQ.value = titulo(i.descricao).split(/\s+/).slice(0, 3).join(' ');
  precos.value = null;
  dlgPrecos.value = true;
  buscarPrecos();
}
async function buscarPrecos() {
  carregandoPrecos.value = true;
  try {
    precos.value = (await api.get(`/disputa/itens/${precoItem.value.id}/precos`, { params: { q: precoQ.value }, timeout: 120000 })).data;
  } finally {
    carregandoPrecos.value = false;
  }
}
onMounted(carregar);
</script>

<style scoped>
.minimo-box { border-radius: 8px; padding: 6px 10px; height: 100%; }
.sugestao { border-radius: 10px; padding: 12px 14px; }
.sug-inicial, .sug-cobrir { background: #e8f0fe; color: #1a3d8f; }
.sug-parar, .sug-abaixo_minimo { background: #fdecea; color: #a61b1b; }
.sug-ganhando { background: #e6f4ea; color: #146c2e; }
.sug-sem_dados, .sug-encerrado { background: #f1f3f4; color: #5f6368; }
.borda-parar { border-color: #e57373; }
.borda-ganhando { border-color: #66bb6a; }
</style>

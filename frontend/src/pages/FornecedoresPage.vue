<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="local_shipping" color="purple-6" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Fornecedores</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Digite o produto e veja <b>quem já vendeu para o governo</b>, por quanto e o contato público. Bom para achar onde comprar e pedir cotação.
    </div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-7">
          <q-input v-model="q" outlined dense clearable autofocus placeholder="Ex.: ventilador de parede, papel A4, detergente" @keyup.enter="buscar">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>
        <div class="col-6 col-md-2"><q-select v-model="uf" :options="UFS" outlined dense clearable label="Estado (prioriza)" /></div>
        <div class="col-6 col-md-3"><q-btn unelevated no-caps color="primary" icon="person_search" label="Buscar fornecedores" class="full-width" :loading="carregando" :disable="(q ?? '').trim().length < 3" @click="buscar" /></div>
      </q-card-section>
      <q-card-section class="q-pt-none text-caption text-grey-7">
        Para pedir cotação de vários itens de uma licitação de uma vez (planilha e e-mail prontos), use <b>Meus negócios → Sala de disputa → 4. Fornecedores</b>.
      </q-card-section>
    </q-card>

    <template v-if="r">
      <div class="row items-center q-mb-sm">
        <div class="col text-body2 text-grey-8">
          {{ r.fornecedores.length }} fornecedor(es) para "<b>{{ r.q }}</b>"
          <span v-if="r.grupos?.[0]"> · preço mediano pago: <b>{{ brl2(r.grupos[0].mediana) }}</b> por {{ r.grupos[0].unidade.toLowerCase() }} ({{ r.grupos[0].quantidade }} compras)</span>
        </div>
      </div>
      <div v-if="buscado && r.q && r.q.toLowerCase() !== buscado.toLowerCase()" class="text-caption text-grey-8 q-mb-sm">
        <q-icon name="info" color="primary" /> Não achamos vendas de "<b>{{ buscado }}</b>"; mostrando os resultados para "<b>{{ r.q }}</b>".
      </div>
      <q-banner v-if="r.incompleto" dense rounded class="bg-blue-1 text-blue-10 q-mb-sm">O PNCP está lento agora: mostrando o que já foi encontrado. Busque de novo em alguns minutos para ver mais.</q-banner>
      <div v-if="!r.fornecedores.length" class="text-grey-7 q-pa-md">Nenhum vencedor encontrado. Tente uma palavra mais curta (ex.: só o nome do produto).</div>
      <q-list v-else bordered separator class="lf-card bg-white">
        <q-item v-for="f in r.fornecedores" :key="f.ni" class="q-py-sm">
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ f.nome }}</q-item-label>
            <q-item-label caption>{{ [cnpj(f.ni), f.porte, `${f.vitorias} venda(s)`, f.ufsAtendidas.join(', '), f.ultimaVenda ? `última em ${data(f.ultimaVenda)}` : ''].filter(Boolean).join(' · ') }}</q-item-label>
            <q-item-label v-if="f.exemplos?.[0]" caption class="ellipsis-2-lines">Ex.: {{ f.exemplos[0].descricao }}</q-item-label>
            <q-item-label v-if="contatos[f.ni]" caption class="q-mt-xs">
              <template v-if="contatos[f.ni].erro">{{ contatos[f.ni].erro }}</template>
              <template v-else>
                <q-icon name="mail" /> <a v-if="contatos[f.ni].email" :href="`mailto:${contatos[f.ni].email}?subject=${encodeURIComponent('Pedido de cotação')}`" class="text-primary">{{ contatos[f.ni].email }}</a><span v-else>sem e-mail no cadastro</span>
                <span class="q-ml-sm"><q-icon name="call" /> {{ telefone(contatos[f.ni].telefone) || 'sem telefone' }}</span>
                <span class="q-ml-sm text-grey-7">{{ contatos[f.ni].municipio }}/{{ contatos[f.ni].uf }}</span>
              </template>
            </q-item-label>
          </q-item-section>
          <q-item-section side class="text-right">
            <div class="text-weight-bold">{{ brl2(f.precoMediano) }}</div>
            <div class="text-caption">por {{ f.unidadePreco.toLowerCase() }} · menor {{ brl2(f.menorPreco) }}</div>
            <div class="row q-gutter-xs justify-end q-mt-xs">
              <q-btn v-if="!contatos[f.ni]" flat dense no-caps size="sm" color="primary" icon="contact_mail" label="Contato" @click="contato(f.ni)" />
              <q-btn flat dense round size="sm" icon="domain" color="grey-8" :to="{ name: 'analise-empresas', params: { cnpj: f.ni } }"><q-tooltip>Ver análise da empresa (produtos e marcas que vende)</q-tooltip></q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-list>
      <div class="text-caption text-grey-6 q-mt-sm">Fontes: itens de licitações com vencedor (Dados Abertos do Compras.gov.br e PNCP). O contato vem do cadastro público na Receita (às vezes é o do contador).</div>
    </template>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { cnpj, data } from 'src/format';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const route = useRoute();
const router = useRouter();
const q = ref(String(route.query.q ?? ''));
const uf = ref(route.query.uf ?? null);
const r = ref(null);
const carregando = ref(false);
const contatos = ref({});
const buscado = ref('');
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const telefone = (t) => (t ? String(t).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '');

async function buscar() {
  if ((q.value ?? '').trim().length < 3) return;
  carregando.value = true;
  router.replace({ query: { q: q.value, uf: uf.value || undefined } });
  try {
    buscado.value = q.value.trim();
    r.value = (await api.get('/fornecedores', { params: { q: q.value, uf: uf.value || undefined }, timeout: 90000 })).data;
  } finally {
    carregando.value = false;
  }
}
async function contato(ni) {
  try {
    contatos.value[ni] = (await api.get(`/disputa/fornecedores/${ni}/contato`, { silencioso: true })).data;
  } catch {
    contatos.value[ni] = { erro: 'Contato indisponível agora.' };
  }
}
onMounted(() => { if (q.value) buscar(); });
</script>

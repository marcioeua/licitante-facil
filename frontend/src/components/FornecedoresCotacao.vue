<template>
  <div>
    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 text-weight-bold">Pedido de cotação</div>
        <div class="text-body2 text-grey-7">Baixe a planilha com os itens e mande o e-mail para os fornecedores. Quando receber os preços, preencha o <b>custo</b> em “1. Preparar preços”.</div>
        <div class="row q-col-gutter-sm q-mt-sm">
          <div class="col-12 col-sm-4"><q-input v-model="empresa" outlined dense label="Sua empresa (assinatura)" /></div>
          <div class="col-6 col-sm-4"><q-input v-model="prazo" outlined dense label="Responder até" placeholder="ex.: 12/11/2026" /></div>
          <div class="col-6 col-sm-4"><q-input v-model="entrega" outlined dense label="Local de entrega" /></div>
        </div>
        <div class="row q-gutter-sm q-mt-sm">
          <q-btn unelevated no-caps color="primary" icon="table_view" label="Baixar planilha (Excel)" @click="baixarPlanilha" />
          <q-btn outline no-caps color="primary" icon="content_copy" label="Copiar e-mail de cotação" @click="copiarEmail" />
          <q-btn flat no-caps color="primary" icon="visibility" :label="verEmail ? 'Esconder e-mail' : 'Ver e-mail'" @click="verEmail = !verEmail" />
        </div>
        <q-input v-if="verEmail" :model-value="textoEmail" type="textarea" outlined autogrow readonly class="q-mt-sm" :input-style="{ fontSize: '13px' }" />
      </q-card-section>
    </q-card>

    <div class="text-subtitle1 text-weight-bold q-mb-xs">Quem vende cada item</div>
    <div class="text-body2 text-grey-7 q-mb-sm">Empresas que <b>venceram itens parecidos</b> em compras públicas (PNCP), com os preços homologados. O contato vem do cadastro público na Receita (às vezes é o do contador).</div>

    <q-card v-for="i in itens" :key="i.id" flat bordered class="lf-card q-mb-md">
      <q-card-section class="row items-center no-wrap q-py-sm">
        <div class="col">
          <div class="text-weight-bold">{{ i.numero_item ? `Item ${i.numero_item} — ` : '' }}{{ titulo(i.descricao) }}</div>
          <div class="text-caption text-grey-7">{{ i.quantidade ? `${num(i.quantidade)} ${i.unidade || 'un.'}` : '' }}{{ i.valor_estimado ? ` · estimado ${brl2(i.valor_estimado)}` : '' }}{{ i.custo != null ? ` · seu custo ${brl2(i.custo)}` : '' }}</div>
        </div>
        <q-btn v-if="!res[i.id]" unelevated no-caps dense color="primary" icon="person_search" label="Buscar fornecedores" :loading="carregando[i.id]" @click="buscar(i)" />
      </q-card-section>

      <template v-if="res[i.id]">
        <q-card-section class="q-pt-none row items-center q-gutter-sm">
          <q-input v-model="termos[i.id]" dense outlined label="Buscar por" style="min-width: 220px" @keyup.enter="buscar(i, termos[i.id])" />
          <q-btn flat dense no-caps icon="search" label="Buscar de novo" :loading="carregando[i.id]" @click="buscar(i, termos[i.id])" />
          <span v-if="res[i.id].grupos?.[0]" class="text-caption text-grey-7">Mediana paga: <b>{{ brl2(res[i.id].grupos[0].mediana) }}</b> por {{ res[i.id].grupos[0].unidade }} ({{ res[i.id].grupos[0].quantidade }} compras)</span>
        </q-card-section>
        <q-card-section v-if="!res[i.id].fornecedores.length" class="q-pt-none text-grey-7">Nenhum vencedor encontrado. Tente palavras mais curtas (ex.: só o nome do produto).</q-card-section>
        <q-list v-else separator class="q-px-sm q-pb-sm">
          <q-item v-for="f in res[i.id].fornecedores" :key="f.ni" class="q-py-sm">
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ f.nome }}</q-item-label>
              <q-item-label caption>
                {{ cnpj(f.ni) }}{{ f.porte ? ` · ${f.porte}` : '' }} · {{ f.vitorias }} venda(s) parecida(s) · {{ f.ufsAtendidas.join(', ') }}{{ f.ultimaVenda ? ` · última em ${data(f.ultimaVenda)}` : '' }}
              </q-item-label>
              <q-item-label v-if="contatos[f.ni]" caption class="text-dark q-mt-xs">
                <template v-if="contatos[f.ni].erro">{{ contatos[f.ni].erro }}</template>
                <template v-else>
                  <q-icon name="mail" /> {{ contatos[f.ni].email || 'sem e-mail no cadastro' }}
                  <span class="q-ml-sm"><q-icon name="call" /> {{ telefone(contatos[f.ni].telefone) || 'sem telefone' }}</span>
                  <span class="q-ml-sm text-grey-7">{{ contatos[f.ni].municipio }}/{{ contatos[f.ni].uf }}{{ contatos[f.ni].situacao && contatos[f.ni].situacao !== 'ATIVA' ? ` · situação ${contatos[f.ni].situacao}` : '' }}</span>
                </template>
              </q-item-label>
            </q-item-section>
            <q-item-section side class="text-right">
              <div class="text-weight-bold text-dark">{{ brl2(f.precoMediano) }}</div>
              <div class="text-caption">por {{ f.unidadePreco.toLowerCase() }} · menor {{ brl2(f.menorPreco) }}</div>
              <div class="row q-gutter-xs justify-end q-mt-xs">
                <q-btn v-if="!contatos[f.ni]" flat dense no-caps size="sm" color="primary" icon="contact_mail" label="Contato" @click="contato(f.ni)" />
                <q-btn v-else-if="contatos[f.ni].email" flat dense no-caps size="sm" color="primary" icon="send" label="Pedir cotação" @click="enviar(contatos[f.ni].email)" />
                <q-btn flat dense round size="sm" icon="domain" color="grey-8" :to="{ name: 'analise-empresas', params: { cnpj: f.ni } }" target="_blank"><q-tooltip>Ver análise da empresa</q-tooltip></q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </template>
    </q-card>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { copyToClipboard, Notify } from 'quasar';
import { api } from 'boot/axios';
import { cnpj, data } from 'src/format';

const props = defineProps({ itens: { type: Array, required: true }, negocio: { type: Object, required: true } });
const res = ref({});
const carregando = ref({});
const termos = ref({});
const contatos = ref({});
const verEmail = ref(false);
const empresa = ref(props.negocio.empresa ?? '');
const prazo = ref('');
const entrega = ref(props.negocio.municipio ? `${props.negocio.municipio}/${props.negocio.uf}` : '');

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const titulo = (d) => {
  const t = String(d ?? '').split(/\s+(?:material|tipo|modelo|características?|especificações?)\s*:|[,;:]/i)[0].trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
};
const telefone = (t) => (t ? String(t).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '');

const assunto = computed(() => `Pedido de cotação — ${props.negocio.objeto ? titulo(props.negocio.objeto).slice(0, 60) : props.negocio.titulo.slice(0, 60)}`);
const textoEmail = computed(() => [
  'Prezados,',
  '',
  `Solicitamos cotação para os itens abaixo${entrega.value ? `, com entrega em ${entrega.value}` : ''}.`,
  '',
  ...props.itens.map((i, k) => `${i.numero_item ?? k + 1}. ${i.descricao.slice(0, 300)} — ${i.quantidade ? `${num(i.quantidade)} ${i.unidade || 'un.'}` : 'quantidade a definir'}`),
  '',
  'Por favor, informem: preço unitário, prazo de entrega, validade da proposta, condições de pagamento e frete.',
  prazo.value ? `Aguardamos o retorno até ${prazo.value}.` : null,
  '',
  'Atenciosamente,',
  empresa.value || '[SUA EMPRESA]',
].filter((l) => l !== null).join('\n'));

async function buscar(i, q) {
  carregando.value[i.id] = true;
  try {
    const r = (await api.get(`/disputa/itens/${i.id}/fornecedores`, { params: q ? { q } : {}, timeout: 120000 })).data;
    res.value[i.id] = r;
    termos.value[i.id] = r.q;
  } finally {
    carregando.value[i.id] = false;
  }
}
async function contato(ni) {
  try {
    contatos.value[ni] = (await api.get(`/disputa/fornecedores/${ni}/contato`, { silencioso: true })).data;
  } catch {
    contatos.value[ni] = { erro: 'Contato indisponível agora.' };
  }
}
async function copiarEmail() {
  await copyToClipboard(`Assunto: ${assunto.value}\n\n${textoEmail.value}`);
  Notify.create({ type: 'positive', message: 'E-mail copiado. Cole no seu e-mail e anexe a planilha.' });
}
function enviar(email) {
  const corpo = textoEmail.value.length > 1500
    ? `Prezados,\n\nSegue em anexo planilha com os itens para cotação.\n\nAtenciosamente,\n${empresa.value || '[SUA EMPRESA]'}`
    : textoEmail.value;
  window.location.href = `mailto:${email}?subject=${encodeURIComponent(assunto.value)}&body=${encodeURIComponent(corpo)}`;
  if (textoEmail.value.length > 1500) Notify.create({ type: 'info', message: 'Lista grande: anexe a planilha de cotação ao e-mail.' });
}
function baixarPlanilha() {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [
    ['Item', 'Descrição', 'Unidade', 'Quantidade', 'Preço unitário (R$)', 'Preço total (R$)', 'Marca/modelo', 'Prazo de entrega', 'Observações'],
    ...props.itens.map((i, k) => [i.numero_item ?? k + 1, i.descricao, i.unidade ?? '', i.quantidade != null ? String(i.quantidade).replace('.', ',') : '', '', '', '', '', '']),
    [],
    ['Empresa fornecedora:', '', '', '', 'Validade da proposta:', '', 'Condições de pagamento:', ''],
    ['Solicitante:', empresa.value],
  ];
  const csv = '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'pedido-de-cotacao.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
</script>

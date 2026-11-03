<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-md">Olá, {{ auth.usuario?.nome?.split(' ')[0] }}</div>
    <div v-if="!d" class="row q-col-gutter-md"><div v-for="i in 4" :key="i" class="col-12 col-md-3"><q-skeleton height="96px" /></div></div>
    <template v-else>
      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-6 col-md-3" v-for="k in kpis" :key="k.nome">
          <q-card flat bordered class="lf-card full-height cursor-pointer" @click="$router.push(k.to)">
            <q-card-section>
              <div class="text-grey-7 text-body2"><q-icon :name="k.icone" /> {{ k.nome }}</div>
              <div class="text-h4 text-weight-bold">{{ k.valor }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8">
          <div class="row items-center q-mb-sm">
            <div class="text-h6 col">Recomendadas para você</div>
            <q-btn flat no-caps color="primary" label="Gerenciar alertas" :to="{ name: 'alertas' }" />
          </div>
          <q-banner v-if="!d.temAlertas" class="bg-blue-1 lf-card q-mb-md">
            <template #avatar><q-icon name="tips_and_updates" color="primary" /></template>
            Crie um alerta com as palavras do que sua empresa vende (por exemplo: "material de limpeza, papel higiênico")
            e as licitações aparecem aqui todos os dias.
            <template #action><q-btn unelevated color="primary" no-caps label="Criar alerta" :to="{ name: 'alertas' }" /></template>
          </q-banner>
          <div v-else-if="!d.recomendadas.length" class="text-grey-7 q-pa-md">Nenhuma oportunidade nova para seus alertas agora.</div>
          <div class="q-gutter-y-md">
            <OportunidadeCard v-for="op in d.recomendadas" :key="op.id" :op="op" />
          </div>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-h6 q-pb-none">Próximas disputas</q-card-section>
            <q-list separator>
              <q-item v-for="n in d.proximasDisputas" :key="n.id" clickable :to="{ name: 'negocio', params: { id: n.id } }">
                <q-item-section>
                  <q-item-label lines="2">{{ n.titulo }}</q-item-label>
                  <q-item-label caption>{{ n.orgao_nome }}</q-item-label>
                </q-item-section>
                <q-item-section side><q-badge color="orange-8" :label="dataHora(n.data_disputa)" /></q-item-section>
              </q-item>
              <q-item v-if="!d.proximasDisputas.length"><q-item-section class="text-grey-7">Nenhuma disputa agendada.</q-item-section></q-item>
            </q-list>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-h6 q-pb-none">Documentos para renovar</q-card-section>
            <q-list separator>
              <q-item v-for="doc in d.documentosAtencao" :key="doc.id" clickable :to="{ name: 'documentos' }">
                <q-item-section>{{ doc.nome }}</q-item-section>
                <q-item-section side>
                  <q-badge :color="diasAte(doc.validade + 'T23:59') < 0 ? 'negative' : 'warning'"
                    :label="diasAte(doc.validade + 'T23:59') < 0 ? 'Vencido' : `Vence ${data(doc.validade)}`" />
                </q-item-section>
              </q-item>
              <q-item v-if="!d.documentosAtencao.length"><q-item-section class="text-grey-7">Tudo em dia nos próximos 7 dias.</q-item-section></q-item>
            </q-list>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from 'boot/axios';
import { useAuth } from 'stores/auth';
import { data, dataHora, diasAte } from 'src/format';
import OportunidadeCard from 'components/OportunidadeCard.vue';

const auth = useAuth();
const d = ref(null);
const ativos = (f) => ['triagem', 'analise', 'proposta', 'disputa'].reduce((s, e) => s + (f[e] ?? 0), 0);
const kpis = computed(() => [
  { nome: 'Licitações abertas', valor: d.value.totalOportunidadesAbertas.toLocaleString('pt-BR'), icone: 'travel_explore', to: { name: 'oportunidades' } },
  { nome: 'Negócios ativos', valor: ativos(d.value.funil), icone: 'view_kanban', to: { name: 'negocios' } },
  { nome: 'Em disputa', valor: d.value.funil.disputa ?? 0, icone: 'gavel', to: { name: 'negocios' } },
  { nome: 'Ganhos', valor: d.value.funil.ganho ?? 0, icone: 'emoji_events', to: { name: 'negocios' } },
]);

onMounted(async () => {
  d.value = (await api.get('/dashboard')).data;
});
</script>

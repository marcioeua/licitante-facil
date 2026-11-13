<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="smart_toy" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Agentes que trabalham por você</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">Cada agente cuida de uma frente. Você liga e configura uma vez; ele trabalha sozinho todo dia e avisa no sino 🔔.</div>

    <TelegramConfig @mudou="(e) => (tele = e)" />
    <WhatsAppConfig @mudou="(e) => (whats = e)" />

    <div v-if="!agentes.length" class="row q-col-gutter-md"><div v-for="i in 3" :key="i" class="col-12 col-md-4"><q-skeleton height="260px" /></div></div>
    <div class="row q-col-gutter-md">
      <div v-for="a in agentes" :key="a.id" class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height column">
          <q-card-section class="row items-start no-wrap">
            <q-avatar :color="VISUAL[a.id].cor" text-color="white" :icon="VISUAL[a.id].icone" size="48px" class="q-mr-md" />
            <div class="col">
              <div class="text-subtitle1 text-weight-bold">{{ a.nome }}</div>
              <q-badge v-if="a.precisaIA && !a.iaDisponivel" color="grey-6" label="Precisa da chave da IA" />
              <q-badge v-else-if="a.ativo" color="positive" label="Ligado" />
              <q-badge v-else color="grey-5" label="Desligado" />
            </div>
            <q-toggle :model-value="a.ativo" :disable="a.precisaIA && !a.iaDisponivel" @update:model-value="(v) => salvar(a, { ativo: v })" />
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8">{{ a.descricao }}</q-card-section>

          <q-card-section class="q-pt-none q-gutter-y-sm">
            <template v-if="a.id === 'prospector'">
              <div class="text-caption text-grey-7">Nota mínima para entrar no funil: <b>{{ a.config.notaMinima }}</b></div>
              <q-slider :model-value="a.config.notaMinima" :min="30" :max="95" :step="5" label @change="(v) => salvar(a, { config: { notaMinima: v } })" />
              <q-select :model-value="a.config.maxPorDia" :options="[5, 10, 20, 30]" outlined dense label="Máximo por dia"
                @update:model-value="(v) => salvar(a, { config: { maxPorDia: v } })" />
              <q-select :model-value="a.config.empresaId" :options="empresas" option-value="id" option-label="razao_social" emit-value map-options clearable
                outlined dense label="Empresa participante (opcional)" @update:model-value="(v) => salvar(a, { config: { empresaId: v ?? null } })" />
              <div class="text-caption text-grey-7">Usa os seus <router-link :to="{ name: 'alertas' }">alertas</router-link> para saber o que procurar.</div>
              <div class="text-caption text-light-blue-9"><q-icon name="send" /> Com o Telegram conectado, cada licitação nova chega lá com o botão <b>"Ler este edital com IA"</b> (funciona mesmo com o Agente Leitor desligado).</div>
            </template>
            <template v-if="a.id === 'vigia'">
              <q-toggle :model-value="a.config.lembrete24h" label="Lembrar 24h antes da disputa" @update:model-value="(v) => salvar(a, { config: { lembrete24h: v } })" />
              <div class="text-caption text-grey-7">Acompanha as licitações do seu funil (menos as ganhas, perdidas e arquivadas) a cada 2 horas.</div>
            </template>
            <template v-if="a.id === 'leitor'">
              <q-toggle :model-value="a.config.automatico !== false" label="Ler sozinho tudo o que entra em Meus negócios"
                @update:model-value="(v) => salvar(a, { config: { automatico: v } })" />
              <div v-if="a.config.automatico === false" class="text-caption text-grey-7">Desligado: só lê o edital que você escolher abaixo ou no botão "Ler este edital com IA" do negócio.</div>
              <div class="row q-col-gutter-sm items-center">
                <div class="col"><q-select v-model="negocioParaLer" :options="negociosLer" option-value="id" option-label="titulo" emit-value map-options outlined dense
                  label="Ler só um edital (✓ = já lido)" :disable="!a.iaDisponivel" options-dense><template #no-option><q-item><q-item-section class="text-grey-7">Nenhum negócio com licitação do PNCP</q-item-section></q-item></template></q-select></div>
                <div class="col-auto"><q-btn unelevated no-caps color="primary" icon="auto_stories" label="Ler" :disable="!negocioParaLer || !a.iaDisponivel" :loading="executando === 'leitor-um'" @click="lerUm(a)" /></div>
              </div>
              <q-select :model-value="a.config.maxPorDia" :options="[1, 3, 5, 10, 20]" outlined dense label="Editais lidos por dia (custo da IA)"
                @update:model-value="(v) => salvar(a, { config: { maxPorDia: v } })" />
              <div v-if="!a.iaDisponivel" class="text-caption text-orange-9">Ative a chave da IA (ANTHROPIC_API_KEY) no Railway para ligar este agente.</div>
            </template>
            <q-toggle :model-value="a.config.email" label="Avisar também por e-mail" @update:model-value="(v) => salvar(a, { config: { email: v } })" />
            <q-toggle v-if="'whatsapp' in a.config" :model-value="a.config.whatsapp" :disable="!whats?.ativo" label="Avisar também pelo WhatsApp"
              @update:model-value="(v) => salvar(a, { config: { whatsapp: v } })"><q-tooltip v-if="!whats?.ativo">Ative o WhatsApp no topo da página</q-tooltip></q-toggle>
            <q-toggle v-if="'telegram' in a.config" :model-value="a.config.telegram" :disable="!tele?.ativo" label="Avisar também pelo Telegram"
              @update:model-value="(v) => salvar(a, { config: { telegram: v } })"><q-tooltip v-if="!tele?.ativo">Conecte o Telegram no topo da página</q-tooltip></q-toggle>
            <q-toggle v-if="'whatsappEdital' in a.config" :model-value="a.config.whatsappEdital" :disable="!(whats?.ativo && a.config.whatsapp) && !(tele?.ativo && a.config.telegram)" label="Mandar o edital em PDF de cada licitação nova (Telegram/WhatsApp)"
              @update:model-value="(v) => salvar(a, { config: { whatsappEdital: v } })" />
          </q-card-section>

          <q-space />
          <q-separator />
          <q-card-section class="q-py-sm">
            <div class="text-caption text-grey-7">
              Última execução: {{ a.ultimaExecucao ? quando(a.ultimaExecucao) : 'nunca' }}
              <span v-if="a.ultimoResultado"> · {{ resumo(a) }}</span>
            </div>
            <div v-if="a.ultimoResultado?.aviso" class="text-caption text-orange-9">{{ a.ultimoResultado.aviso }}</div>
            <q-list dense class="q-mt-xs">
              <q-item v-for="n in a.recentes" :key="n.id" dense class="q-px-none">
                <q-item-section><q-item-label caption lines="2">• {{ n.titulo }}</q-item-label></q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-card-actions>
            <q-btn flat no-caps color="primary" icon="play_arrow" :label="a.id === 'leitor' ? 'Ler todos os pendentes' : 'Executar agora'" :loading="executando === a.id"
              :disable="a.precisaIA && !a.iaDisponivel" @click="executar(a)" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Já existentes / em breve -->
      <div class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height cursor-pointer" @click="$router.push({ name: 'pagometro' })">
          <q-card-section class="row items-start no-wrap">
            <q-avatar color="teal-7" text-color="white" icon="speed" size="48px" class="q-mr-md" />
            <div class="col"><div class="text-subtitle1 text-weight-bold">Pagômetro</div><q-badge color="positive" label="Disponível" /></div>
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8">Este órgão costuma pagar em dia? Nota de capacidade de pagamento do Tesouro Nacional em cada licitação.</q-card-section>
        </q-card>
      </div>
      <div class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height column">
          <q-card-section class="row items-start no-wrap">
            <q-avatar color="green-7" text-color="white" icon="forum" size="48px" class="q-mr-md" />
            <div class="col"><div class="text-subtitle1 text-weight-bold">Busca Pregão no Chat</div><q-badge color="positive" label="Disponível" /></div>
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8 col">Pergunte no Claude ou no ChatGPT, em português: “licitação de até 50 mil que não exija atestado”. Eles buscam aqui e leem os editais.</q-card-section>
          <q-card-actions><q-btn unelevated no-caps color="primary" icon="link" label="Conectar ao Claude ou ChatGPT" :to="{ name: 'chat' }" /></q-card-actions>
        </q-card>
      </div>
      <div class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height column">
          <q-card-section class="row items-start no-wrap">
            <q-avatar color="brown-6" text-color="white" icon="balance" size="48px" class="q-mr-md" />
            <div class="col"><div class="text-subtitle1 text-weight-bold">Agente Jurídico</div><q-badge color="positive" label="Disponível" /></div>
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8 col">Lê o edital, aponta possíveis irregularidades e redige esclarecimentos, impugnações, recursos e contrarrazões para revisão do seu advogado.</q-card-section>
          <q-card-actions><q-btn unelevated no-caps color="primary" icon="balance" label="Abrir peças jurídicas" :to="{ name: 'juridico' }" /></q-card-actions>
        </q-card>
      </div>
      <div class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height column">
          <q-card-section class="row items-start no-wrap">
            <q-avatar color="purple-6" text-color="white" icon="local_shipping" size="48px" class="q-mr-md" />
            <div class="col"><div class="text-subtitle1 text-weight-bold">Agente Fornecedor</div><q-badge color="positive" label="Disponível" /></div>
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8 col">Mostra quem vendeu cada item ao governo e por quanto, com o contato público, e monta a planilha e o e-mail de cotação. Abra um negócio → <b>Sala de disputa</b> → <b>4. Fornecedores</b>.</q-card-section>
          <q-card-actions><q-btn unelevated no-caps color="primary" icon="view_kanban" label="Ir para Meus negócios" :to="{ name: 'negocios' }" /></q-card-actions>
        </q-card>
      </div>
      <div v-for="e in EM_BREVE" :key="e.nome" class="col-12 col-md-4">
        <q-card flat bordered class="lf-card full-height" style="opacity: 0.75">
          <q-card-section class="row items-start no-wrap">
            <q-avatar :color="e.cor" text-color="white" :icon="e.icone" size="48px" class="q-mr-md" />
            <div class="col"><div class="text-subtitle1 text-weight-bold">{{ e.nome }}</div><q-badge color="grey-6" label="Em breve" /></div>
          </q-card-section>
          <q-card-section class="q-pt-none text-body2 text-grey-8">{{ e.descricao }}</q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { api } from 'boot/axios';
import WhatsAppConfig from 'components/WhatsAppConfig.vue';
import TelegramConfig from 'components/TelegramConfig.vue';

const $q = useQuasar();
const router = useRouter();
const agentes = ref([]);
const empresas = ref([]);
const executando = ref(null);
const negocioParaLer = ref(null);
const negociosLer = ref([]);
const whats = ref(null);
const tele = ref(null);
const VISUAL = {
  prospector: { cor: 'blue-7', icone: 'travel_explore' },
  vigia: { cor: 'deep-orange-7', icone: 'visibility' },
  leitor: { cor: 'indigo-7', icone: 'auto_stories' },
};
const EM_BREVE = [
];

const quando = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function resumo(a) {
  const r = a.ultimoResultado;
  if (a.id === 'prospector') return `${r.adicionadas ?? 0} adicionada(s) de ${r.avaliadas ?? 0} avaliada(s)`;
  if (a.id === 'vigia') return `${r.acompanhadas ?? 0} acompanhada(s), ${r.mudancas ?? 0} mudança(s)`;
  return `${r.lidos ?? 0} edital(is) lido(s)`;
}
async function carregar() {
  agentes.value = (await api.get('/agentes')).data;
}
async function salvar(a, mudanca) {
  const { data } = await api.put(`/agentes/${a.id}`, mudanca);
  Object.assign(a, data);
  if ('ativo' in mudanca) $q.notify({ type: 'positive', message: `${a.nome} ${data.ativo ? 'ligado' : 'desligado'}.` });
}
async function lerUm(a) {
  executando.value = 'leitor-um';
  try {
    const { data } = await api.post('/agentes/leitor/executar', { negocioId: negocioParaLer.value }, { timeout: 300000 });
    if (data.aviso) $q.notify({ type: 'warning', message: data.aviso });
    else if (data.erros?.length) $q.notify({ type: 'negative', message: `Não deu para ler: ${data.erros[0]}` });
    else $q.notify({ type: 'positive', message: `Edital lido: ${data.titulo}. Veja o resultado no negócio.`, actions: [{ label: 'Abrir', color: 'white', handler: () => router.push({ name: 'negocio', params: { id: data.negocioId } }) }] });
    negocioParaLer.value = null;
    await carregar();
  } finally {
    executando.value = null;
  }
}
async function executar(a) {
  executando.value = a.id;
  try {
    const { data } = await api.post(`/agentes/${a.id}/executar`, {}, { timeout: 300000 });
    $q.notify({ type: data.aviso ? 'warning' : 'positive', message: data.aviso ?? `${a.nome}: ${resumo({ ...a, ultimoResultado: data })}.` });
    await carregar();
  } finally {
    executando.value = null;
  }
}
onMounted(async () => {
  await carregar();
  empresas.value = (await api.get('/empresas')).data;
  negociosLer.value = (await api.get('/negocios')).data.filter((x) => x.oportunidade_id && !['ganho', 'perdido'].includes(x.etapa))
    .map((x) => ({ ...x, titulo: `${x.edital_lido ? '✓ ' : ''}${x.titulo}` }));
});
</script>

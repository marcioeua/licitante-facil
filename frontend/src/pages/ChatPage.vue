<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="forum" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Busca Pregão no Chat</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Converse com o Claude ou o ChatGPT e peça licitações em português. Eles consultam o Busca Pregão IA e leem os editais para você.
    </div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-7">
        <q-card flat bordered class="lf-card q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-sm">1. Seu link pessoal do conector</div>
            <q-skeleton v-if="!estado" height="60px" />
            <template v-else-if="link">
              <q-input :model-value="link" readonly outlined dense>
                <template #append><q-btn flat dense no-caps color="primary" icon="content_copy" label="Copiar" @click="copiar" /></template>
              </q-input>
              <div class="text-caption text-negative q-mt-xs">Copie agora: por segurança, ele só aparece uma vez. Se perder, gere outro.</div>
            </template>
            <template v-else-if="estado.ativo">
              <div class="text-body2">
                <q-icon name="check_circle" color="positive" /> Link ativo desde {{ dataHora(estado.criado_em + 'Z') }}.
                <span v-if="estado.ultimo_uso">Último uso: {{ dataHora(estado.ultimo_uso + 'Z') }} ({{ estado.chamadas }} consultas).</span>
                <span v-else>Ainda não foi usado.</span>
              </div>
            </template>
            <div v-else class="text-body2 text-grey-8">Gere o link e cole no Claude ou no ChatGPT, como explicado abaixo.</div>
            <div v-if="estado" class="row q-gutter-sm q-mt-md">
              <q-btn unelevated no-caps color="primary" :icon="estado.ativo ? 'autorenew' : 'link'" :label="estado.ativo ? 'Gerar novo link' : 'Gerar meu link'" :loading="gerando" @click="gerar" />
              <q-btn v-if="estado.ativo" flat no-caps color="negative" icon="link_off" label="Desativar" @click="desativar" />
            </div>
            <q-banner rounded dense class="bg-amber-1 text-amber-10 q-mt-md">
              <template #avatar><q-icon name="lock" /></template>
              O link dá acesso às buscas e à leitura de editais na sua conta. Não compartilhe. Gerar um novo desliga o anterior.
            </q-banner>
            <div v-if="estado && !estado.ia" class="text-caption text-grey-7 q-mt-sm">A leitura de editais com IA ainda não está ligada no servidor: a busca funciona, mas a verificação de atestado não.</div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="lf-card q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-sm">2. Conecte no Claude</div>
            <ol class="q-pl-md q-my-none text-body2">
              <li>Abra <b>claude.ai</b> → <b>Configurações</b> → <b>Conectores</b>.</li>
              <li>Clique em <b>Adicionar conector personalizado</b>.</li>
              <li>Nome: <code>Busca Pregão IA</code>. URL: cole o seu link.</li>
              <li>Em uma conversa nova, ative o conector no botão de ferramentas e faça a pergunta.</li>
            </ol>
            <div class="text-caption text-grey-7 q-mt-xs">Disponível nos planos pagos do Claude.</div>
          </q-card-section>
          <q-separator />
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-sm">3. Ou conecte no ChatGPT</div>
            <ol class="q-pl-md q-my-none text-body2">
              <li>Abra <b>chatgpt.com</b> → <b>Configurações</b> → <b>Apps e conectores</b> → <b>Avançado</b> e ative o <b>Modo desenvolvedor</b>.</li>
              <li>Volte em <b>Apps e conectores</b> e clique em <b>Criar</b>.</li>
              <li>Nome: <code>Busca Pregão IA</code>. URL do servidor MCP: cole o seu link. Autenticação: <b>Nenhuma</b>.</li>
              <li>Em uma conversa nova, escolha o conector no botão <b>+</b> e faça a pergunta.</li>
            </ol>
            <div class="text-caption text-grey-7 q-mt-xs">Disponível nos planos pagos do ChatGPT. Os nomes dos menus podem mudar um pouco.</div>
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-5">
        <q-card flat bordered class="lf-card q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-sm">Exemplos de perguntas</div>
            <q-list dense>
              <q-item v-for="e in EXEMPLOS" :key="e"><q-item-section avatar class="min-w-0"><q-icon name="chat_bubble_outline" color="primary" size="18px" /></q-item-section><q-item-section class="text-body2">“{{ e }}”</q-item-section></q-item>
            </q-list>
          </q-card-section>
        </q-card>
        <q-card flat bordered class="lf-card">
          <q-card-section class="text-body2 text-grey-8">
            <div class="text-subtitle1 text-weight-bold text-dark q-mb-sm">Sobre o atestado de capacidade técnica</div>
            Essa exigência fica dentro do edital. O chat só diz que uma licitação <b>não exige</b> atestado depois que a IA leu o edital.
            As ainda não lidas aparecem como <b>“não verificado”</b>, e o chat pode ler na hora (1 a 2 minutos por edital).
            Cada leitura conta no limite diário de análises com IA.
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Notify, copyToClipboard, useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { dataHora } from 'src/format';

const EXEMPLOS = [
  'Quero uma licitação de até 50 mil reais que não exija atestado de capacidade técnica',
  'Pregões de material de limpeza abertos em São Paulo até R$ 80 mil',
  'Dispensas de informática em Minas Gerais que encerram esta semana',
  'Leia o edital da licitação 1234 e me diga quais documentos preciso',
];

const $q = useQuasar();
const estado = ref(null);
const token = ref('');
const gerando = ref(false);
const link = computed(() => (token.value ? `${window.location.origin}/mcp/${token.value}` : ''));

async function carregar() {
  estado.value = (await api.get('/conector')).data;
}
async function gerar() {
  const fazer = async () => {
    gerando.value = true;
    try {
      token.value = (await api.post('/conector')).data.token;
      await carregar();
    } finally {
      gerando.value = false;
    }
  };
  if (!estado.value.ativo) return fazer();
  $q.dialog({ title: 'Gerar novo link?', message: 'O link atual deixa de funcionar e você precisará colar o novo no Claude/ChatGPT.', cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Gerar novo', color: 'primary', unelevated: true } }).onOk(fazer);
}
function desativar() {
  $q.dialog({ title: 'Desativar o conector?', message: 'O Claude e o ChatGPT deixam de acessar sua conta.', cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Desativar', color: 'negative', unelevated: true } })
    .onOk(async () => {
      await api.delete('/conector');
      token.value = '';
      await carregar();
    });
}
async function copiar() {
  await copyToClipboard(link.value);
  Notify.create({ type: 'positive', message: 'Link copiado.' });
}
onMounted(carregar);
</script>

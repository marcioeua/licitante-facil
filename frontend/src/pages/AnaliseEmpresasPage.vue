<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-xs">Análise de empresas</div>
    <div class="text-body2 text-grey-7 q-mb-md">Pesquise um concorrente (ou a sua empresa) pelo nome ou CNPJ e veja como ele vende para o governo.</div>

    <q-card flat bordered class="lf-card q-mb-md">
      <q-card-section class="row q-col-gutter-sm items-center">
        <div class="col-12 col-md-7">
          <q-select v-model="escolhida" :options="sugestoes" option-value="ni" option-label="nome" use-input hide-selected fill-input
            input-debounce="300" outlined dense clearable placeholder="Nome da empresa ou CNPJ" @filter="filtrar" @update:model-value="(v) => v && abrir(v.ni)">
            <template #prepend><q-icon name="search" /></template>
            <template #option="{ itemProps, opt }">
              <q-item v-bind="itemProps">
                <q-item-section><q-item-label>{{ opt.nome }}</q-item-label><q-item-label caption>CNPJ {{ cnpj(opt.ni) }}</q-item-label></q-item-section>
                <q-item-section side class="text-caption">{{ opt.contratos }} contrato(s)</q-item-section>
              </q-item>
            </template>
            <template #no-option><q-item><q-item-section class="text-grey-7">Digite pelo menos 3 letras ou números do CNPJ</q-item-section></q-item></template>
          </q-select>
        </div>
        <div class="col-12 col-md-5">
          <q-btn-toggle v-model="dias" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9"
            :options="[{ label: '90 dias', value: 90 }, { label: '6 meses', value: 182 }, { label: '12 meses', value: 365 }]" />
        </div>
        <div v-if="minhas.length" class="col-12 row items-center q-gutter-xs">
          <span class="text-caption text-grey-7 q-mr-xs">Minhas empresas:</span>
          <q-chip v-for="e in minhas" :key="e.id" clickable dense color="blue-1" text-color="primary" icon="business" @click="abrir(e.cnpj)">{{ e.razao_social }}</q-chip>
        </div>
      </q-card-section>
    </q-card>

    <!-- Comparação -->
    <q-card v-if="comparar.length" flat bordered class="lf-card q-mb-md">
      <q-card-section class="row items-center q-pb-sm">
        <div class="col text-subtitle1 text-weight-medium">Comparação</div>
        <q-btn flat dense no-caps color="grey-8" label="Limpar" @click="comparar = []; tabelaComparacao = []" />
      </q-card-section>
      <q-markup-table flat dense separator="horizontal">
        <thead><tr><th class="text-left">Empresa</th><th class="text-right">Valor</th><th class="text-right">Contratos</th><th class="text-right">Contrato médio</th><th class="text-right">Clientes</th><th class="text-right">Estados</th><th /></tr></thead>
        <tbody>
          <tr v-for="c in tabelaComparacao" :key="c.cnpj">
            <td class="text-left"><a href="#" class="text-primary" @click.prevent="abrir(c.cnpj)">{{ c.nome ?? cnpj(c.cnpj) }}</a></td>
            <td class="text-right">{{ brl(c.valor) }}</td><td class="text-right">{{ num(c.contratos) }}</td><td class="text-right">{{ brl(c.ticketMedio) }}</td>
            <td class="text-right">{{ num(c.clientes) }}</td><td class="text-right">{{ num(c.estados) }}</td>
            <td><q-btn flat round dense size="sm" icon="close" @click="removerComparacao(c.cnpj)" /></td>
          </tr>
        </tbody>
      </q-markup-table>
    </q-card>

    <div v-if="!p && !carregando" class="text-center text-grey-7 q-pa-xl">
      <q-icon name="manage_search" size="56px" /><br />Escolha uma empresa para ver a análise.
    </div>
    <q-skeleton v-if="carregando" height="320px" />

    <template v-if="p && !carregando">
      <!-- Cabeçalho -->
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row items-start q-col-gutter-md">
          <div class="col-12 col-md">
            <div class="text-h6 text-weight-bold">{{ p.cadastro?.razaoSocial ?? p.nome ?? 'Empresa' }}</div>
            <div v-if="p.cadastro?.nomeFantasia" class="text-body2 text-grey-8">{{ p.cadastro.nomeFantasia }}</div>
            <div class="text-caption text-grey-7">CNPJ {{ cnpj(p.cnpj) }}</div>
            <div v-if="p.cadastro" class="q-gutter-xs q-mt-sm">
              <q-badge v-if="p.cadastro.porte" color="blue-1" text-color="primary" :label="p.cadastro.porte" />
              <q-badge v-if="p.cadastro.simples" color="teal-1" text-color="teal-9" label="Simples Nacional" />
              <q-badge v-if="p.cadastro.mei" color="teal-1" text-color="teal-9" label="MEI" />
              <q-badge v-if="p.cadastro.situacao" :color="p.cadastro.situacao === 'ATIVA' ? 'green-1' : 'red-1'" :text-color="p.cadastro.situacao === 'ATIVA' ? 'green-9' : 'red-9'" :label="`Situação: ${p.cadastro.situacao}`" />
            </div>
            <div v-if="p.cadastro" class="text-body2 q-mt-sm">
              <div v-if="p.cadastro.atividade"><span class="text-grey-7">Atividade principal:</span> {{ p.cadastro.atividade }}</div>
              <div><span class="text-grey-7">Sede:</span> {{ p.cadastro.municipio }}/{{ p.cadastro.uf }}<span v-if="p.cadastro.abertura"> · aberta em {{ data(p.cadastro.abertura) }}</span>
                <span v-if="p.cadastro.capitalSocial"> · capital social {{ brl(p.cadastro.capitalSocial) }}</span></div>
            </div>
            <div v-else class="text-caption text-grey-6 q-mt-sm">Dados cadastrais da Receita indisponíveis no momento.</div>
          </div>
          <div class="col-12 col-md-auto q-gutter-sm">
            <q-btn outline no-caps color="primary" icon="compare_arrows" label="Comparar" :disable="comparar.includes(p.cnpj) || comparar.length >= 4" @click="adicionarComparacao(p.cnpj)" />
            <q-btn flat no-caps color="primary" icon="handshake" label="Contratos" :to="{ name: 'historico', query: { aba: 'contratos' } }" />
          </div>
        </q-card-section>
      </q-card>

      <!-- Números -->
      <div class="row q-col-gutter-md q-mb-md">
        <div v-for="k in kpis" :key="k.nome" class="col-6 col-md-2">
          <q-card flat bordered class="lf-card full-height"><q-card-section>
            <div class="text-caption text-grey-7">{{ k.nome }}</div>
            <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
          </q-card-section></q-card>
        </div>
      </div>
      <div class="text-caption text-grey-7 q-mb-md">
        <q-icon name="info" /> Valores de <b>contratos e empenhos assinados</b> publicados no PNCP<span v-if="p.periodo?.de"> desde {{ data(p.periodo.de) }}</span>.
        Não inclui disputas perdidas nem atas de registro de preço que ainda não viraram contrato, por isso pode ser menor que o "valor vencido" de outras ferramentas.
      </div>
      <div v-if="!p.resumo.contratos" class="text-grey-7 q-mb-md">Nenhum contrato desta empresa no período carregado.</div>

      <!-- Vitórias (dados abertos do Compras.gov.br) -->
      <q-card flat bordered class="lf-card q-mb-md">
        <q-card-section class="row items-center q-pb-sm">
          <q-icon name="emoji_events" color="amber-8" size="24px" class="q-mr-sm" />
          <div class="col">
            <div class="text-subtitle1 text-weight-medium">Vitórias em licitações</div>
            <div class="text-caption text-grey-7">Itens vencidos e valores homologados (Lei 14.133), dados abertos oficiais do Compras.gov.br</div>
          </div>
          <q-btn-toggle v-model="anosVitorias" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9"
            :options="[{ label: '1 ano', value: 1 }, { label: '3 anos', value: 3 }, { label: '5 anos', value: 5 }]" />
        </q-card-section>
        <q-card-section v-if="carregandoVitorias" class="row items-center q-gutter-sm text-grey-7">
          <q-spinner-dots color="primary" size="28px" /><span>Consultando o Compras.gov.br...</span>
        </q-card-section>
        <q-card-section v-else-if="erroVitorias" class="text-grey-7">{{ erroVitorias }}</q-card-section>
        <template v-else-if="vit">
          <q-card-section class="q-pt-none row q-col-gutter-md">
            <div v-for="k in kpisVitorias" :key="k.nome" class="col-6 col-sm">
              <div class="text-caption text-grey-7">{{ k.nome }}</div>
              <div class="text-h6 text-weight-bold">{{ k.valor }}</div>
            </div>
          </q-card-section>
          <q-card-section v-if="!vit.resumo.itens" class="q-pt-none text-grey-7">
            Nenhuma vitória registrada nos dados abertos no período. Licitações da lei antiga e de alguns portais podem não aparecer.
          </q-card-section>
          <template v-else>
            <q-card-section v-if="vit.produtos?.length" class="q-pt-none">
              <div class="produtos-caixa">
                <div class="row items-center q-mb-sm">
                  <q-icon name="inventory_2" color="primary" size="22px" class="q-mr-sm" />
                  <div class="col">
                    <div class="text-subtitle1 text-weight-bold">Produtos que vende ({{ num(vit.produtos.length) }})</div>
                    <div class="text-caption text-grey-7">O que esta empresa venceu nas licitações, agrupado por produto. Clique para ver os itens.</div>
                  </div>
                </div>
                <div v-if="vit.marcas?.length" class="q-mb-sm">
                  <div class="text-caption text-weight-medium text-grey-8 q-mb-xs">Marcas que mais vende</div>
                  <q-chip v-for="m in vit.marcas.slice(0, 12)" :key="m.marca" dense clickable color="deep-purple-1" text-color="deep-purple-9" class="marca-badge" @click="filtroProdutos = m.marca; mostrarProdutos = 10">
                    {{ m.marca }}<span class="q-ml-xs text-caption">· {{ brlCurto(m.valor) }}</span>
                    <q-tooltip>{{ m.vezes }} item(ns): {{ m.produtos.join(', ') }}</q-tooltip>
                  </q-chip>
                </div>
                <q-input v-model="filtroProdutos" dense outlined clearable placeholder="Procurar produto ou marca (ex.: caneta, papel, BIC)" class="q-mb-sm" @update:model-value="mostrarProdutos = 10">
                  <template #prepend><q-icon name="search" /></template>
                </q-input>
                <div v-if="!produtosFiltrados.length" class="text-grey-7 q-pa-sm">Nenhum produto com esse nome.</div>
                <q-list separator>
                  <q-item v-for="pr in produtosFiltrados.slice(0, mostrarProdutos)" :key="pr.chave" clickable class="q-px-sm" @click="verItensDoProduto(pr)">
                    <q-item-section>
                      <q-item-label class="text-weight-medium">{{ pr.nome }}</q-item-label>
                      <q-item-label caption>
                        {{ num(pr.vezes) }} item(ns) vencido(s) em {{ num(pr.compras) }} licitação(ões) · {{ num(pr.orgaos) }} órgão(s)<span v-if="pr.ufs.length"> · {{ pr.ufs.slice(0, 6).join(', ') }}{{ pr.ufs.length > 6 ? '…' : '' }}</span> · último em {{ data(pr.ultima) }}
                      </q-item-label>
                      <q-item-label v-if="pr.marcas?.length" class="q-mt-xs">
                        <span class="text-caption text-grey-7 q-mr-xs">Marca:</span>
                        <q-badge v-for="m in pr.marcas.slice(0, 4)" :key="m.marca" color="deep-purple-1" text-color="deep-purple-9" class="q-mr-xs q-mb-xs marca-badge" :label="pr.marcas.length > 1 ? `${m.marca} (${m.vezes})` : m.marca" />
                        <span v-if="pr.marcas.length > 4" class="text-caption text-grey-7">+{{ pr.marcas.length - 4 }}</span>
                      </q-item-label>
                      <q-item-label v-if="pr.precoMediano != null" caption>
                        Preço unitário<span v-if="pr.unidade"> ({{ pr.unidade }})</span>:
                        <b class="text-positive">{{ brl2(pr.precoMediano) }}</b> típico<span v-if="pr.precoMin !== pr.precoMax"> · de {{ brl2(pr.precoMin) }} a {{ brl2(pr.precoMax) }}</span>
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side class="text-right">
                      <div class="text-weight-bold">{{ brlCurto(pr.valor) }}</div>
                      <div class="text-caption">{{ pctValor(pr.valor) }} do total</div>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-if="produtosFiltrados.length > mostrarProdutos" class="q-mt-xs">
                  <q-btn flat dense no-caps color="primary" :label="`Ver mais produtos (${num(produtosFiltrados.length - mostrarProdutos)} restantes)`" @click="mostrarProdutos += 20" />
                </div>
                <div class="text-caption text-grey-6 q-mt-xs">
                  Valores homologados nas licitações vencidas (dados oficiais).
                  Marca: como a empresa declarou no Compras.gov.br (a fonte guarda até 20 letras; outros portais não publicam a marca)<span v-if="vit.resumo.itens"> · encontrada em {{ num(vit.itensComMarca) }} de {{ num(vit.resumo.itens) }} itens</span><span v-if="vit.marcasPendentes"> (ainda buscando; abra de novo em alguns minutos)</span>.
                  <span v-if="vit.itensSemDescricao">{{ num(vit.itensSemDescricao) }} item(ns) ainda sem descrição do PNCP não entraram na lista<span v-if="vit.detalhesPendentes"> (carregando; abra de novo em alguns minutos)</span>.</span>
                </div>
              </div>
            </q-card-section>
            <q-card-section v-if="vit.porAno.length > 1" class="q-pt-none">
              <BarrasVerticais :itens="vit.porAno.map((a) => ({ rotulo: a.chave, valor: a.valor, detalhe: `${a.itens} item(ns) em ${a.compras} compra(s)` }))" :formatar="brlCurto" :altura="150" titulo="Valor vencido por ano" />
            </q-card-section>
            <q-card-section ref="secaoItens" class="q-pt-none row q-col-gutter-sm items-center">
              <div class="col-12 col-sm"><q-input v-model="filtroItens" dense outlined clearable placeholder="Filtrar por item, órgão, cidade ou portal" @update:model-value="mostrarItens = 20"><template #prepend><q-icon name="search" /></template></q-input></div>
              <div class="col-12 col-sm-auto"><q-btn-toggle v-model="ordemItens" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9"
                :options="[{ label: 'Mais recentes', value: 'data' }, { label: 'Maior valor', value: 'valor' }, { label: 'Maior desconto', value: 'desconto' }]" /></div>
              <div v-if="vit.porPortal?.length" class="col-12 text-caption text-grey-7">
                Portais: <span v-for="(pt, k) in vit.porPortal" :key="pt.chave">{{ k ? ' · ' : '' }}{{ pt.chave }} ({{ num(pt.itens) }})</span>
              </div>
            </q-card-section>
            <q-card-section class="q-pt-none">
              <div v-if="!itensFiltrados.length" class="text-grey-7">Nenhum item encontrado com esse filtro.</div>
              <div v-for="(i, k) in itensFiltrados.slice(0, mostrarItens)" :key="`${i.compra}-${i.item}-${k}`" class="vit-item q-mb-md">
                <div class="row items-start no-wrap q-gutter-x-sm">
                  <div class="col">
                    <div class="text-caption text-grey-7 vit-origem">
                      <span class="text-weight-medium text-primary">{{ i.portal || 'Portal não identificado' }}</span>
                      <span v-if="i.unidadeCompradora || i.orgao"> · {{ i.unidadeCompradora || i.orgao }}</span>
                      <span v-if="i.modalidade"> · {{ i.modalidade }}</span>
                      <span v-if="i.numeroCompra"> Nº {{ i.numeroCompra }}/{{ i.anoCompra }}</span>
                    </div>
                    <div v-if="i.unidadeCompradora && i.orgao && i.unidadeCompradora !== i.orgao" class="text-caption text-grey-6">{{ i.orgao }}</div>
                  </div>
                  <q-badge outline color="grey-8" :label="i.municipio ? `${i.municipio} / ${i.uf}` : i.uf" />
                </div>
                <div class="row items-center q-mt-xs q-gutter-x-sm">
                  <div class="text-subtitle1 text-weight-bold">Item {{ i.item }} — {{ i.titulo || 'Descrição não informada' }}</div>
                  <q-badge v-if="i.marca" color="deep-purple-1" text-color="deep-purple-9" class="marca-badge" :label="`Marca: ${i.marca}`" />
                  <q-badge v-if="i.situacaoItem" color="green-1" text-color="green-9" :label="i.situacaoItem" />
                  <q-badge v-if="i.beneficioMeEpp" color="teal-1" text-color="teal-9" label="Benefício ME/EPP" />
                </div>
                <div v-if="i.descricao && i.descricao.trim() !== i.titulo" class="text-body2 text-grey-8 q-mt-xs">{{ i.descricao }}</div>
                <div class="row q-col-gutter-sm q-mt-sm">
                  <div class="col-12 col-md-5">
                    <div class="vit-caixa">
                      <div class="row q-col-gutter-sm">
                        <div class="col-4"><div class="vit-rotulo">Abertura</div><div>{{ i.abertura ? dataHora(i.abertura) : '—' }}</div></div>
                        <div class="col-4"><div class="vit-rotulo">Quantidade</div><div>{{ num(i.quantidade) }}</div></div>
                        <div class="col-4"><div class="vit-rotulo">Unidade</div><div>{{ i.unidade || '—' }}</div></div>
                      </div>
                      <div class="text-caption text-grey-6 q-mt-xs">Resultado publicado em {{ data(i.data) }}<span v-if="i.criterio"> · {{ i.criterio }}</span></div>
                    </div>
                  </div>
                  <div class="col-12 col-md-7">
                    <div class="vit-caixa vit-vencedor">
                      <div class="vit-rotulo">Vencedor</div>
                      <div class="text-weight-medium">{{ cnpj(i.fornecedorNi) }}<span v-if="i.fornecedor"> — {{ i.fornecedor }}</span></div>
                      <div v-if="i.porte" class="text-caption text-grey-7">Porte: {{ i.porte }}</div>
                      <div class="row q-col-gutter-sm q-mt-xs">
                        <div class="col-6"><div class="vit-rotulo">Valor homologado (unit.)</div><div class="text-subtitle1 text-weight-bold text-positive">{{ brl2(i.valorUnitario) }}</div></div>
                        <div class="col-6"><div class="vit-rotulo">Valor total homologado</div><div class="text-subtitle1 text-weight-bold">{{ brl2(i.valorTotal) }}</div></div>
                      </div>
                      <div v-if="i.valorEstimado" class="text-caption text-grey-7">
                        Estimado pelo órgão: {{ brl2(i.valorEstimado) }} por unidade<span v-if="i.desconto != null && i.desconto > 0"> · <b class="text-positive">{{ pct(i.desconto) }} abaixo do estimado</b></span>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="row q-gutter-sm q-mt-xs">
                  <q-btn v-if="i.linkPncp || linkPncp(i.compra)" flat dense no-caps size="sm" color="primary" icon="open_in_new" label="Ver no PNCP" :href="i.linkPncp || linkPncp(i.compra)" target="_blank" rel="noopener" />
                  <q-btn v-if="i.linkOrigem" flat dense no-caps size="sm" color="primary" icon="launch" :label="`Abrir no ${i.portal || 'portal'}`" :href="i.linkOrigem" target="_blank" rel="noopener" />
                </div>
              </div>
            </q-card-section>
            <q-card-actions v-if="itensFiltrados.length > mostrarItens"><q-btn flat no-caps color="primary" :label="`Ver mais itens (${num(itensFiltrados.length - mostrarItens)} restantes)`" @click="mostrarItens += 20" /></q-card-actions>
          </template>
          <q-card-section class="text-caption text-grey-6">
            Fonte: {{ vit.fonte }}. Mostra apenas vitórias (os dados públicos não informam participações nem derrotas).
            <span v-if="vit.detalhesPendentes">Os detalhes de alguns itens ainda estão carregando do PNCP; abra de novo em alguns minutos.</span>
            <span v-if="vit.falhas.length">Não foi possível consultar parte do período agora.</span>
          </q-card-section>
        </template>
      </q-card>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-8 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Vendas por mês</q-card-section>
            <q-card-section class="q-pt-none">
              <BarrasVerticais :itens="meses" :formatar="brlCurto" :altura="200" titulo="Vendas por mês" />
              <div class="text-caption text-grey-6 q-mt-sm">Barras listradas: meses em consolidação. Mostra a sazonalidade das vendas da empresa.</div>
            </q-card-section>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="row items-center q-pb-sm">
              <div class="col text-subtitle1 text-weight-medium">Principais clientes</div>
              <div v-if="pctRisco != null" class="text-caption" :class="pctRisco > 0.3 ? 'text-negative' : 'text-grey-7'">
                {{ pct(pctRisco) }} do valor vendido para órgãos com risco de atraso
              </div>
            </q-card-section>
            <q-list separator>
              <q-item v-for="c in p.clientes" :key="c.cnpj" clickable
                :to="{ name: 'historico', query: { aba: 'contratos', orgao: c.cnpj, fornecedor: p.cnpj, nome: `${p.nome} com ${c.nome}` } }">
                <q-item-section>
                  <q-item-label>{{ c.nome }}</q-item-label>
                  <q-item-label caption>{{ c.municipio ? `${c.municipio}/` : '' }}{{ c.uf }} · {{ c.contratos }} contrato(s) · última {{ data(c.ultima) }}</q-item-label>
                  <q-item-label caption class="text-primary">Ver os contratos com este cliente</q-item-label>
                </q-item-section>
                <q-item-section side class="items-end">
                  <div class="text-weight-medium text-dark">{{ brl(c.valor) }}</div>
                  <q-badge v-if="PAG[c.pagometro]" :color="PAG[c.pagometro].cor" :label="PAG[c.pagometro].nome" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>

          <q-card v-if="p.itens.length" flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Itens vencidos e preços</q-card-section>
            <q-markup-table flat dense>
              <thead><tr><th class="text-left">Item</th><th class="text-right">Preço unit.</th><th class="text-left">Unidade</th><th class="text-left">Comprador</th><th class="text-right">Data</th></tr></thead>
              <tbody>
                <tr v-for="(i, k) in p.itens" :key="k">
                  <td class="text-left" style="white-space: normal; max-width: 320px">
                    <a v-if="linkPncp(i.compra_controle)" :href="linkPncp(i.compra_controle)" target="_blank" rel="noopener" class="text-primary">{{ i.descricao }}</a>
                    <span v-else>{{ i.descricao }}</span>
                  </td>
                  <td class="text-right">{{ brl2(i.valor_unitario) }}</td><td class="text-left">{{ i.unidade }}</td>
                  <td class="text-left" style="white-space: normal">{{ i.orgao ?? '—' }}</td><td class="text-right">{{ data(i.data_resultado) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
            <div class="text-caption text-grey-6 q-pa-sm">Itens das compras já consultadas na pesquisa de preços.</div>
          </q-card>

          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Contratos recentes</q-card-section>
            <q-list separator>
              <q-item v-for="c in p.recentes" :key="c.id" :clickable="!!linkContrato(c.numero_controle_pncp)" @click="abrirExterno(linkContrato(c.numero_controle_pncp))">
                <q-item-section>
                  <q-item-label lines="2">{{ c.objeto }}</q-item-label>
                  <q-item-label caption>{{ c.orgao_nome }} · {{ c.municipio }}/{{ c.uf }}</q-item-label>
                  <q-item-label v-if="linkContrato(c.numero_controle_pncp)" caption class="text-primary q-mt-xs">
                    <q-icon name="open_in_new" size="14px" /> Ver contrato no PNCP
                    <a v-if="linkPncp(c.compra_controle)" :href="linkPncp(c.compra_controle)" target="_blank" rel="noopener" class="q-ml-md text-primary" @click.stop>Ver edital da licitação</a>
                  </q-item-label>
                </q-item-section>
                <q-item-section side top class="text-right"><div class="text-weight-medium text-dark">{{ brl(c.valor_global) }}</div><div class="text-caption">{{ data(c.data_assinatura) }}</div></q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">O que vende</q-card-section>
            <q-card-section class="q-pt-none">
              <div v-if="!p.assuntos.length" class="text-grey-7">Sem dados suficientes.</div>
              <q-chip v-for="a in p.assuntos" :key="a.termo" clickable dense color="grey-2" text-color="grey-9"
                @click="$router.push({ name: 'mercado', query: { q: a.termo } })">
                {{ a.termo }} <span class="text-grey-6 q-ml-xs">{{ a.contratos }}</span>
                <q-tooltip>{{ a.contratos }} contrato(s) · {{ brl(a.valor) }} · clique para ver o mercado</q-tooltip>
              </q-chip>
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Onde vende</q-card-section>
            <q-card-section class="q-pt-none">
              <MapaBrasil :dados="Object.fromEntries(p.porUf.map((u) => [u.uf, u.valor]))" :formatar="brl" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-sm">Para quem vende (esfera)</q-card-section>
            <q-card-section class="q-pt-none">
              <BarraParticipacao :partes="p.porEsfera.map((e) => ({ chave: e.esfera, rotulo: e.nome, valor: e.valor }))" :cores="CORES_ESFERA" :formatar="brl" />
            </q-card-section>
          </q-card>
          <q-card flat bordered class="lf-card">
            <q-card-section class="text-subtitle1 text-weight-medium q-pb-none">Concorrentes diretos</q-card-section>
            <q-card-section class="q-pt-xs text-caption text-grey-7">Empresas que mais venderam para os mesmos clientes no período.</q-card-section>
            <q-list dense>
              <q-item v-for="c in p.concorrentes" :key="c.ni" clickable @click="abrir(c.ni)">
                <q-item-section><q-item-label lines="1">{{ c.nome }}</q-item-label><q-item-label caption>{{ c.clientesEmComum }} cliente(s) em comum · {{ brl(c.valor) }}</q-item-label></q-item-section>
                <q-item-section side><q-btn flat round dense size="sm" icon="compare_arrows" @click.stop="adicionarComparacao(c.ni)"><q-tooltip>Comparar</q-tooltip></q-btn></q-item-section>
              </q-item>
              <q-item v-if="!p.concorrentes.length"><q-item-section class="text-grey-7">Nenhum concorrente encontrado.</q-item-section></q-item>
            </q-list>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { brl, cnpj, data, dataHora } from 'src/format';
import BarrasVerticais from 'components/graficos/BarrasVerticais.vue';
import MapaBrasil from 'components/graficos/MapaBrasil.vue';
import BarraParticipacao from 'components/graficos/BarraParticipacao.vue';

const CORES_ESFERA = { M: '#2a78d6', E: '#eb6834', F: '#1baf7a', D: '#eda100', N: '#6250d6' };
const PAG = { baixo: { cor: 'positive', nome: 'Paga em dia' }, medio: { cor: 'orange-8', nome: 'Atenção' }, alto: { cor: 'negative', nome: 'Risco de atraso' }, federal: { cor: 'primary', nome: 'Federal' } };
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const route = useRoute();
const router = useRouter();
const escolhida = ref(null);
const sugestoes = ref([]);
const minhas = ref([]);
const dias = ref(365);
const p = ref(null);
const carregando = ref(false);
const comparar = ref([]);
const vit = ref(null);
const carregandoVitorias = ref(false);
const erroVitorias = ref('');
const anosVitorias = ref(3);
const mostrarItens = ref(20);
const filtroItens = ref('');
const ordemItens = ref('data');
const filtroProdutos = ref('');
const mostrarProdutos = ref(10);
const secaoItens = ref(null);
const tabelaComparacao = ref([]);

const num = (v) => Number(v ?? 0).toLocaleString('pt-BR');
const pct = (v) => `${((v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
const brl2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));
const brlCurto = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : brl(v));
const intervalo = () => ({ de: new Date(Date.now() - dias.value * 86400000).toISOString().slice(0, 10), ate: new Date().toISOString().slice(0, 10) });

const kpis = computed(() => [
  { nome: 'Contratado (assinado)', valor: brlCurto(p.value.resumo.valor) },
  { nome: 'Contratos', valor: num(p.value.resumo.contratos) },
  { nome: 'Contrato típico', valor: brlCurto(p.value.resumo.ticketMediano ?? 0) },
  { nome: 'Clientes', valor: num(p.value.resumo.clientes) },
  { nome: 'Estados', valor: num(p.value.resumo.estados) },
  { nome: 'Última venda', valor: p.value.resumo.ultima ? data(p.value.resumo.ultima) : '—' },
]);
const meses = computed(() => (p.value?.porMes ?? []).map((x) => ({
  rotulo: MESES[Number(x.mes.slice(5, 7)) - 1], rotuloLongo: `${MESES[Number(x.mes.slice(5, 7)) - 1]}/${x.mes.slice(0, 4)}`,
  valor: x.valor, detalhe: `${num(x.contratos)} contrato(s)`, parcial: x.consolidando,
})));
const kpisVitorias = computed(() => [
  { nome: 'Itens vencidos', valor: num(vit.value.resumo.itens) },
  { nome: 'Licitações', valor: num(vit.value.resumo.compras) },
  { nome: 'Valor vencido', valor: brlCurto(vit.value.resumo.valor) },
  { nome: 'Órgãos', valor: num(vit.value.resumo.orgaos) },
  { nome: 'Com benefício ME/EPP', valor: num(vit.value.resumo.beneficioMeEpp) },
  ...(vit.value.resumo.descontoMedio != null ? [{ nome: 'Desconto médio s/ estimado', valor: pct(vit.value.resumo.descontoMedio) }] : []),
]);
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const itensFiltrados = computed(() => {
  const termos = semAcento(filtroItens.value).split(/\s+/).filter(Boolean);
  const lista = (vit.value?.itens ?? []).filter((i) => {
    if (!termos.length) return true;
    const texto = semAcento([i.titulo, i.marca, i.descricao, i.orgao, i.unidadeCompradora, i.municipio, i.uf, i.portal, i.modalidade, i.numeroCompra].join(' '));
    return termos.every((t) => texto.includes(t));
  });
  const chave = { data: (i) => i.data ?? '', valor: (i) => i.valorTotal ?? 0, desconto: (i) => i.desconto ?? -1 }[ordemItens.value];
  return [...lista].sort((a, b) => (chave(a) < chave(b) ? 1 : chave(a) > chave(b) ? -1 : 0));
});
const produtosFiltrados = computed(() => {
  const termos = semAcento(filtroProdutos.value).split(/\s+/).filter(Boolean);
  return (vit.value?.produtos ?? []).filter((pr) => termos.every((t) => semAcento(`${pr.nome} ${pr.chave} ${(pr.marcas ?? []).map((m) => m.marca).join(' ')}`).includes(t)));
});
const pctValor = (v) => {
  const t = vit.value?.resumo.valor;
  if (!t) return '—';
  const f = v / t;
  return f < 0.001 ? 'menos de 0,1%' : `${(f * 100).toLocaleString('pt-BR', { maximumFractionDigits: f < 0.01 ? 1 : 0 })}%`;
};
function verItensDoProduto(pr) {
  filtroItens.value = pr.chave;
  mostrarItens.value = 20;
  ordemItens.value = 'data';
  secaoItens.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const abrirExterno = (url) => { if (url) window.open(url, '_blank', 'noopener'); };
// Número de controle do contrato no PNCP: CNPJ-2-SEQUENCIAL/ANO.
function linkContrato(controle) {
  const m = String(controle ?? '').match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
  return m ? `https://pncp.gov.br/app/contratos/${m[1]}/${m[3]}/${m[2]}` : null;
}
function linkPncp(controle) {
  const m = String(controle ?? '').match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
  return m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null;
}
async function carregarVitorias(ni) {
  vit.value = null;
  erroVitorias.value = '';
  if (!ni) return;
  carregandoVitorias.value = true;
  mostrarItens.value = 20;
  filtroItens.value = '';
  filtroProdutos.value = '';
  mostrarProdutos.value = 10;
  try {
    vit.value = (await api.get(`/analise-empresas/${ni}/vitorias`, { params: { anos: anosVitorias.value }, timeout: 180000, silencioso: true })).data;
  } catch {
    erroVitorias.value = 'Não foi possível consultar o Compras.gov.br agora. Tente novamente em instantes.';
  } finally {
    carregandoVitorias.value = false;
  }
}
const pctRisco = computed(() => {
  const r = p.value?.riscoClientes ?? {};
  const total = Object.values(r).reduce((a, b) => a + b, 0);
  return total ? (r.alto ?? 0) / total : null;
});

function filtrar(texto, atualizar) {
  if (!texto || texto.length < 3) return atualizar(() => (sugestoes.value = []));
  api.get('/analise-empresas/sugestoes', { params: { q: texto } }).then(({ data: d }) => atualizar(() => (sugestoes.value = d)));
}
function abrir(ni) {
  router.replace({ name: 'analise-empresas', params: { cnpj: String(ni).replace(/\D/g, '') } });
}
async function carregar(ni) {
  if (!ni) { p.value = null; return; }
  carregando.value = true;
  try {
    p.value = (await api.get(`/analise-empresas/${ni}`, { params: intervalo(), timeout: 60000 })).data;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    carregando.value = false;
  }
}
async function atualizarComparacao() {
  tabelaComparacao.value = comparar.value.length ? (await api.get('/analise-empresas/comparar', { params: { cnpjs: comparar.value.join(','), ...intervalo() } })).data : [];
}
function adicionarComparacao(ni) {
  if (!comparar.value.includes(ni) && comparar.value.length < 4) comparar.value.push(ni);
  atualizarComparacao();
}
function removerComparacao(ni) {
  comparar.value = comparar.value.filter((x) => x !== ni);
  atualizarComparacao();
}

watch(() => route.params.cnpj, (c) => { carregar(c); carregarVitorias(c); });
watch(anosVitorias, () => carregarVitorias(route.params.cnpj));
watch(dias, () => { carregar(route.params.cnpj); atualizarComparacao(); });
onMounted(async () => {
  minhas.value = (await api.get('/empresas')).data;
  if (route.params.cnpj) { carregar(route.params.cnpj); carregarVitorias(route.params.cnpj); }
});
</script>

<style scoped>
.vit-item { border: 1px solid #e3e6ea; border-radius: 10px; padding: 14px 16px; }
.vit-caixa { background: #f6f8fa; border-radius: 8px; padding: 10px 12px; height: 100%; }
.marca-badge { font-weight: 600; }
.produtos-caixa { border: 1px solid rgba(29, 78, 216, 0.25); background: rgba(29, 78, 216, 0.04); border-radius: 10px; padding: 12px; }
.vit-vencedor { background: #f1f8f4; }
.vit-rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
.vit-origem { line-height: 1.4; }
</style>

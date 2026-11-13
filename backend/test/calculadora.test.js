import { test } from 'node:test';
import assert from 'node:assert/strict';
const c = await import('../../frontend/src/calculadora.js');
const perto = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('Simples Nacional: alíquota efetiva pelas tabelas da LC 123', () => {
  perto(c.aliquotaSimples('I', 100000).efetiva, 0.04, 1e-9);
  // R$ 500 mil no Anexo I: (500000 × 9,5% − 13.860) / 500000 = 6,728%
  perto(c.aliquotaSimples('I', 500000).efetiva, 0.06728, 1e-6);
  assert.equal(c.aliquotaSimples('I', 500000).faixa, 3);
  // R$ 1 milhão no Anexo III: (1.000.000 × 16% − 35.640) / 1.000.000 = 12,436%
  perto(c.aliquotaSimples('III', 1000000).efetiva, 0.12436, 1e-6);
  assert.equal(c.aliquotaSimples('I', 5000000).acimaDoLimite, true);
});

test('ICMS interestadual pelas resoluções do Senado', () => {
  assert.equal(c.aliquotaInterestadual('SP', 'SP'), null);
  assert.equal(c.aliquotaInterestadual('SP', 'BA'), 0.07);
  assert.equal(c.aliquotaInterestadual('SP', 'ES'), 0.07);
  assert.equal(c.aliquotaInterestadual('SP', 'RJ'), 0.12);
  assert.equal(c.aliquotaInterestadual('BA', 'SP'), 0.12);
  assert.equal(c.aliquotaInterestadual('ES', 'BA'), 0.12);
  assert.equal(c.aliquotaInterestadual('SP', 'BA', true), 0.04);
});

test('Lucro Presumido com DIFAL: preço mínimo e preço com margem fecham a conta', () => {
  const e = { regime: 'presumido', tipo: 'mercadoria', custo: 100, frete: 10, ufOrigem: 'SP', ufDestino: 'BA', icmsInternoDestino: 20.5, icmsCreditoCompra: 12 };
  const s = c.estrutura(e);
  perto(s.inter, 0.07, 1e-9);
  perto(s.difal, 0.135, 1e-9); // base única: 20,5% − 7%
  const minimo = c.precoParaMargem(e, 0);
  perto(c.analisarPreco(e, minimo).lucro, 0, 1e-6);
  const p20 = c.precoParaMargem(e, 20);
  perto(c.analisarPreco(e, p20).margem, 0.20, 1e-9);
  // Base dupla é maior que a base única.
  assert.ok(c.estrutura({ ...e, difalMetodo: 'dupla' }).difal > s.difal);
});

test('Simples não paga DIFAL (ADI 5464) e Lucro Real tributa o lucro', () => {
  const simples = c.estrutura({ regime: 'simples', tipo: 'mercadoria', rbt12: 500000, custo: 100, ufOrigem: 'SP', ufDestino: 'BA', icmsInternoDestino: 20.5 });
  assert.equal(simples.difal, null);
  assert.ok(simples.avisos.some((a) => /ADI 5464/.test(a)));
  const real = { regime: 'real', tipo: 'mercadoria', custo: 100, ufOrigem: 'SP', ufDestino: 'SP', icmsInternoOrigem: 18, icmsCreditoCompra: 18 };
  const p = c.precoParaMargem(real, 15);
  perto(c.analisarPreco(real, p).margem, 0.15, 1e-9);
  perto(c.analisarPreco(real, c.precoParaMargem(real, 0)).lucro, 0, 1e-6);
  // Retenção federal só fora do Simples.
  perto(c.analisarPreco({ ...real, orgaoFederal: true }, 1000).retencao, 58.5, 1e-9);
  assert.equal(c.analisarPreco({ regime: 'simples', tipo: 'mercadoria', custo: 1, orgaoFederal: true }, 1000).retencao, 0);
  const lances = c.tabelaDeLances(real, 200, p, 4);
  assert.equal(lances.length, 5);
  assert.ok(lances[0].lucro > lances[4].lucro);
});

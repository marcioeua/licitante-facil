import { buscarOportunidades } from '../services/busca.js';
import { parseAlerta, filtrosDoAlerta } from './alertas.js';

export default async function (app) {
  const { db } = app;

  app.get('/', async (req) => {
    const uid = req.usuarioId;
    const hoje = new Date().toISOString().slice(0, 10);
    const em7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const funil = Object.fromEntries(
      db.prepare('SELECT etapa, count(*) AS n FROM negocios WHERE usuario_id = ? AND arquivado = 0 GROUP BY etapa')
        .all(uid).map((r) => [r.etapa, r.n]),
    );

    const proximasDisputas = db.prepare(`
      SELECT n.id, n.titulo, n.data_disputa, n.etapa, o.orgao_nome, o.uf
      FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id
      WHERE n.usuario_id = ? AND n.arquivado = 0 AND n.etapa NOT IN ('ganho','perdido')
        AND n.data_disputa >= ? ORDER BY n.data_disputa LIMIT 5`).all(uid, hoje);

    const docs = db.prepare(`
      SELECT id, nome, validade FROM documentos
      WHERE usuario_id = ? AND validade IS NOT NULL AND validade <= ? ORDER BY validade LIMIT 10`).all(uid, em7);

    // Recomendadas: resultados dos alertas do usuário, sem as que já estão no funil.
    const alertas = db.prepare('SELECT * FROM alertas WHERE usuario_id = ?').all(uid).map(parseAlerta);
    const vistos = new Set();
    const recomendadas = [];
    for (const a of alertas) {
      const { itens } = buscarOportunidades(db, { ...filtrosDoAlerta(a), tamanho: 10, ordem: 'publicacao' }, uid);
      for (const op of itens) {
        if (op.negocio_id || vistos.has(op.id)) continue;
        vistos.add(op.id);
        recomendadas.push({ ...op, alerta: a.nome });
      }
    }

    return {
      funil,
      proximasDisputas,
      documentosAtencao: docs,
      recomendadas: recomendadas.slice(0, 10),
      totalOportunidadesAbertas: buscarOportunidades(db, { tamanho: 1 }).total,
      temAlertas: alertas.length > 0,
    };
  });
}
